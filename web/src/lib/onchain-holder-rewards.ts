import "server-only";

import crypto from "node:crypto";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import { getRedis } from "@/lib/server/redis";
import {
  KODIAK_IS_DEVNET,
  KODIAK_NETWORK,
  KODIAK_RPC_URL,
} from "@/lib/solana/network";

const PROGRAM_ID = new PublicKey(
  "68ueodLyUjvPDYq7tkfV6NSy3ThAwtQcBGvMtg6aVUTB",
);

const CONFIG_SEED = Buffer.from("kodiak-rewards");
const VAULT_SEED = Buffer.from("vault");
const EPOCH_SEED = Buffer.from("epoch");
const CLAIM_SEED = Buffer.from("claim");
const LEAF_DOMAIN = Buffer.from("kodiak-sol-rewards-v1");

const MAX_BATCH_WALLETS = 128;
const PUBLISH_LOCK_SECONDS = 180;
const INFLIGHT_UNCERTAIN_MS = 120_000;

const connection = new Connection(
  process.env.SOLANA_DEVNET_RPC_URL?.trim() ||
    process.env.SOLANA_RPC_URL?.trim() ||
    KODIAK_RPC_URL,
  "confirmed",
);

function rewardPrefix(mint: string) {
  return `kodiak:${KODIAK_NETWORK}:holder-rewards:${mint}`;
}

function pendingKey(mint: string, wallet: string) {
  return `${rewardPrefix(mint)}:pending:${wallet}`;
}

function pendingWalletsKey(mint: string) {
  return `${rewardPrefix(mint)}:pending-wallets`;
}

function claimedKey(mint: string, wallet: string) {
  return `${rewardPrefix(mint)}:claimed:${wallet}`;
}

function totalClaimedKey(mint: string) {
  return `${rewardPrefix(mint)}:claimed-lamports`;
}

function activeClaimsKey(mint: string, wallet: string) {
  return `${rewardPrefix(mint)}:onchain-active-list:${wallet}`;
}

function publishLockKey(mint: string) {
  return `${rewardPrefix(mint)}:publish-lock`;
}

function publishInflightKey(mint: string) {
  return `${rewardPrefix(mint)}:publish-inflight`;
}

function authorityKeypair() {
  if (!KODIAK_IS_DEVNET) {
    throw new Error("On-chain rewards publishing is Devnet-only.");
  }

  const raw =
    process.env.KODIAK_DEVNET_REWARDS_AUTHORITY_SECRET_KEY?.trim();

  if (!raw) {
    throw new Error(
      "KODIAK_DEVNET_REWARDS_AUTHORITY_SECRET_KEY is not configured.",
    );
  }

  const parsed = JSON.parse(raw) as number[];

  if (!Array.isArray(parsed) || parsed.length !== 64) {
    throw new Error("Rewards authority secret key is invalid.");
  }

  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

function discriminator(name: string) {
  return crypto
    .createHash("sha256")
    .update(`global:${name}`)
    .digest()
    .subarray(0, 8);
}

function u64(value: bigint | number) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
}

function i64(value: bigint | number) {
  const out = Buffer.alloc(8);
  out.writeBigInt64LE(BigInt(value));
  return out;
}

function u32(value: number) {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value);
  return out;
}

function hashParts(parts: Buffer[]) {
  const hasher = crypto.createHash("sha256");
  for (const part of parts) hasher.update(part);
  return hasher.digest();
}

function rewardLeaf(
  epochId: bigint,
  wallet: PublicKey,
  amount: bigint,
) {
  return hashParts([
    LEAF_DOMAIN,
    u64(epochId),
    wallet.toBuffer(),
    u64(amount),
  ]);
}

function combineHashes(a: Buffer, b: Buffer) {
  return Buffer.compare(a, b) <= 0
    ? hashParts([a, b])
    : hashParts([b, a]);
}

type Allocation = {
  wallet: string;
  publicKey: PublicKey;
  amount: number;
  leaf: Buffer;
  proof: Buffer[];
};

type ActiveClaim = {
  epochId: string;
  amount: number;
  epoch: string;
  receipt: string;
  proof: string[];
};

type PublishInflight = {
  epochId: string;
  mint: string;
  createdAt: number;
  signature?: string;
  allocations: Array<{
    wallet: string;
    amount: number;
    epoch: string;
    receipt: string;
    proof: string[];
  }>;
};

function buildMerkleAllocations(
  epochId: bigint,
  rows: Array<{
    wallet: string;
    amount: number;
  }>,
): {
  root: Buffer;
  allocations: Allocation[];
} {
  const sorted = [...rows].sort((a, b) =>
    a.wallet.localeCompare(b.wallet),
  );

  const allocations: Allocation[] = sorted.map((row) => {
    const publicKey = new PublicKey(row.wallet);
    return {
      ...row,
      publicKey,
      leaf: rewardLeaf(
        epochId,
        publicKey,
        BigInt(row.amount),
      ),
      proof: [],
    };
  });

  if (allocations.length === 0) {
    throw new Error("No reward allocations were supplied.");
  }

  let level = allocations.map((row, index) => ({
    hash: row.leaf,
    indexes: [index],
  }));

  while (level.length > 1) {
    const next: typeof level = [];

    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1];

      if (!right) {
        next.push(left);
        continue;
      }

      for (const index of left.indexes) {
        allocations[index].proof.push(right.hash);
      }

      for (const index of right.indexes) {
        allocations[index].proof.push(left.hash);
      }

      next.push({
        hash: combineHashes(left.hash, right.hash),
        indexes: [...left.indexes, ...right.indexes],
      });
    }

    level = next;
  }

  return {
    root: level[0].hash,
    allocations,
  };
}

function pdas(
  mint: PublicKey,
  epochId?: bigint,
  claimant?: PublicKey,
) {
  const [config] = PublicKey.findProgramAddressSync(
    [CONFIG_SEED, mint.toBuffer()],
    PROGRAM_ID,
  );

  const [vault] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, config.toBuffer()],
    PROGRAM_ID,
  );

  const epoch =
    epochId === undefined
      ? null
      : PublicKey.findProgramAddressSync(
          [
            EPOCH_SEED,
            config.toBuffer(),
            u64(epochId),
          ],
          PROGRAM_ID,
        )[0];

  const receipt =
    epoch && claimant
      ? PublicKey.findProgramAddressSync(
          [
            CLAIM_SEED,
            epoch.toBuffer(),
            claimant.toBuffer(),
          ],
          PROGRAM_ID,
        )[0]
      : null;

  return {
    config,
    vault,
    epoch,
    receipt,
  };
}

async function nextEpochId(config: PublicKey) {
  const info = await connection.getAccountInfo(
    config,
    "confirmed",
  );

  if (!info || !info.owner.equals(PROGRAM_ID)) {
    throw new Error(
      "Kodiak rewards config is not initialized for this mint.",
    );
  }

  // Anchor discriminator 8
  // authority 32
  // mint 32
  // vault_bump 1
  // config_bump 1
  // paused 1
  // next_epoch_id starts at byte 75.
  return info.data.readBigUInt64LE(75);
}

async function readInt(key: string) {
  const value = await getRedis().get<string | number>(key);
  const n = Number(value ?? 0);

  return Number.isSafeInteger(n) && n >= 0
    ? n
    : 0;
}

async function readActiveClaims(
  mint: string,
  wallet: string,
) {
  const rows = await getRedis().lrange<ActiveClaim>(
    activeClaimsKey(mint, wallet),
    0,
    -1,
  );

  return Array.isArray(rows)
    ? rows
    : [];
}

function encodeProof(proof: Buffer[]) {
  return Buffer.concat([
    u32(proof.length),
    ...proof,
  ]);
}

export async function getOnchainRewardsStatus(
  mintString: string,
  wallet?: string,
) {
  const mint = new PublicKey(mintString);
  const { config, vault } = pdas(mint);

  const [vaultLamports, activeClaims] =
    await Promise.all([
      connection.getBalance(vault, "confirmed"),
      wallet
        ? readActiveClaims(mintString, wallet)
        : Promise.resolve([]),
    ]);

  const activeLamports = activeClaims.reduce(
    (sum, row) => sum + row.amount,
    0,
  );

  return {
    rewardsProgram: PROGRAM_ID.toBase58(),
    config: config.toBase58(),
    vault: vault.toBase58(),
    vaultConfigured: true,
    vaultLamports,
    vaultSol:
      vaultLamports / LAMPORTS_PER_SOL,
    activeOnchainClaims: activeClaims,
    activeClaimLamports: activeLamports,
    activeClaimSol:
      activeLamports / LAMPORTS_PER_SOL,
  };
}


async function releasePublishLock(
  mint: string,
  token: string,
) {
  const redis = getRedis();

  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    end
    return 0
  `;

  await redis.eval(
    script,
    [publishLockKey(mint)],
    [token],
  );
}

async function reserveInflightRewards(
  inflight: PublishInflight,
) {
  const redis = getRedis();

  const pendingKeys =
    inflight.allocations.map(
      (allocation) =>
        pendingKey(
          inflight.mint,
          allocation.wallet,
        ),
    );

  const script = `
    if redis.call("EXISTS", KEYS[1]) == 1 then
      return 0
    end

    local count = tonumber(ARGV[2])

    for i = 1, count do
      local pending = tonumber(redis.call("GET", KEYS[i + 1]) or "0")
      local amount = tonumber(ARGV[i + 2])

      if pending < amount then
        return -i
      end
    end

    for i = 1, count do
      redis.call("INCRBY", KEYS[i + 1], -tonumber(ARGV[i + 2]))
    end

    redis.call("SET", KEYS[1], ARGV[1])
    return 1
  `;

  const result = await redis.eval(
    script,
    [
      publishInflightKey(
        inflight.mint,
      ),
      ...pendingKeys,
    ],
    [
      JSON.stringify(inflight),
      String(
        inflight.allocations.length,
      ),
      ...inflight.allocations.map(
        (allocation) =>
          String(allocation.amount),
      ),
    ],
  );

  const code = Number(result);

  if (code === 0) {
    throw new Error(
      "Another rewards epoch is already reserved for publication.",
    );
  }

  if (code < 0) {
    throw new Error(
      "Pending reward balances changed while the epoch was being prepared. Retry publication.",
    );
  }
}

async function persistInflightSignature(
  inflight: PublishInflight,
) {
  await getRedis().set(
    publishInflightKey(
      inflight.mint,
    ),
    inflight,
  );
}

async function epochExistsForInflight(
  inflight: PublishInflight,
) {
  const mint =
    new PublicKey(inflight.mint);

  const epoch = pdas(
    mint,
    BigInt(inflight.epochId),
  ).epoch;

  if (!epoch) {
    return false;
  }

  const info =
    await connection.getAccountInfo(
      epoch,
      "confirmed",
    );

  return Boolean(
    info &&
      info.owner.equals(
        PROGRAM_ID,
      ),
  );
}


async function finalizePublishedEpoch(
  inflight: PublishInflight,
) {
  const redis = getRedis();

  const claimKeys =
    inflight.allocations.map(
      (allocation) =>
        activeClaimsKey(
          inflight.mint,
          allocation.wallet,
        ),
    );

  const activeClaims =
    inflight.allocations.map(
      (allocation) =>
        JSON.stringify({
          epochId:
            inflight.epochId,
          amount:
            allocation.amount,
          epoch:
            allocation.epoch,
          receipt:
            allocation.receipt,
          proof:
            allocation.proof,
        } satisfies ActiveClaim),
    );

  const script = `
    local raw = redis.call("GET", KEYS[1])

    if not raw then
      return 0
    end

    local current = cjson.decode(raw)

    if tostring(current["epochId"]) ~= ARGV[1] then
      return -1
    end

    local count = tonumber(ARGV[2])

    for i = 1, count do
      redis.call("RPUSH", KEYS[i + 1], ARGV[i + 2])
    end

    redis.call("DEL", KEYS[1])
    return 1
  `;

  const result = await redis.eval(
    script,
    [
      publishInflightKey(
        inflight.mint,
      ),
      ...claimKeys,
    ],
    [
      inflight.epochId,
      String(
        activeClaims.length,
      ),
      ...activeClaims,
    ],
  );

  const code = Number(result);

  if (code < 0) {
    throw new Error(
      "Rewards inflight epoch changed before finalization.",
    );
  }
}

async function restoreInflightRewards(
  inflight: PublishInflight,
) {
  const redis = getRedis();

  const pendingKeys =
    inflight.allocations.map(
      (allocation) =>
        pendingKey(
          inflight.mint,
          allocation.wallet,
        ),
    );

  const script = `
    local raw = redis.call("GET", KEYS[1])

    if not raw then
      return 0
    end

    local current = cjson.decode(raw)

    if tostring(current["epochId"]) ~= ARGV[1] then
      return -1
    end

    local count = tonumber(ARGV[2])

    for i = 1, count do
      redis.call("INCRBY", KEYS[i + 1], tonumber(ARGV[i + 2]))
      redis.call("SADD", KEYS[count + 2], ARGV[count + i + 2])
    end

    redis.call("DEL", KEYS[1])
    return 1
  `;

  const result = await redis.eval(
    script,
    [
      publishInflightKey(
        inflight.mint,
      ),
      ...pendingKeys,
      pendingWalletsKey(
        inflight.mint,
      ),
    ],
    [
      inflight.epochId,
      String(
        inflight.allocations.length,
      ),
      ...inflight.allocations.map(
        (allocation) =>
          String(allocation.amount),
      ),
      ...inflight.allocations.map(
        (allocation) =>
          allocation.wallet,
      ),
    ],
  );

  const code = Number(result);

  if (code < 0) {
    throw new Error(
      "Rewards inflight epoch changed before restoration.",
    );
  }
}

async function reconcileInflightPublish(
  mintString: string,
) {
  const redis = getRedis();

  const inflight =
    await redis.get<PublishInflight>(
      publishInflightKey(
        mintString,
      ),
    );

  if (!inflight) {
    return {
      reconciled: false,
    } as const;
  }

  const onchainEpochExists =
    await epochExistsForInflight(
      inflight,
    );

  if (onchainEpochExists) {
    await finalizePublishedEpoch(
      inflight,
    );

    return {
      reconciled: true,
      status: "finalized-from-chain",
    } as const;
  }

  const ageMs =
    Math.max(
      0,
      Date.now() -
        Number(
          inflight.createdAt ?? 0,
        ),
    );

  if (!inflight.signature) {
    if (
      ageMs <
      INFLIGHT_UNCERTAIN_MS
    ) {
      return {
        reconciled: false,
        status: "broadcast-uncertain",
      } as const;
    }

    await restoreInflightRewards(
      inflight,
    );

    return {
      reconciled: true,
      status: "restored-unbroadcast",
    } as const;
  }

  const status =
    await connection.getSignatureStatus(
      inflight.signature,
      {
        searchTransactionHistory: true,
      },
    );

  const value =
    status.value;

  if (value?.err) {
    await restoreInflightRewards(
      inflight,
    );

    return {
      reconciled: true,
      status: "restored-failed",
    } as const;
  }

  if (
    value?.confirmationStatus ===
      "confirmed" ||
    value?.confirmationStatus ===
      "finalized"
  ) {
    await finalizePublishedEpoch(
      inflight,
    );

    return {
      reconciled: true,
      status: "finalized",
    } as const;
  }

  if (
    ageMs <
    INFLIGHT_UNCERTAIN_MS
  ) {
    return {
      reconciled: false,
      status: "confirmation-pending",
    } as const;
  }

  // After the uncertainty window, the epoch PDA is
  // still absent and the transaction is not confirmed.
  // At this point the reservation can be restored.
  await restoreInflightRewards(
    inflight,
  );

  return {
    reconciled: true,
    status: "restored-expired",
  } as const;
}

export async function publishPendingRewardsEpoch(
  mintString: string,
) {
  if (!KODIAK_IS_DEVNET) {
    return {
      published: false,
      reason: "not-devnet",
    } as const;
  }

  const redis = getRedis();

  const lockToken =
    crypto.randomUUID();

  const lock = await redis.set(
    publishLockKey(mintString),
    lockToken,
    {
      nx: true,
      ex: PUBLISH_LOCK_SECONDS,
    },
  );

  if (!lock) {
    return {
      published: false,
      reason: "publisher-busy",
    } as const;
  }

  try {
    const reconciliation =
      await reconcileInflightPublish(
        mintString,
      );

    if (
      "status" in reconciliation &&
      (
        reconciliation.status ===
          "confirmation-pending" ||
        reconciliation.status ===
          "broadcast-uncertain"
      )
    ) {
      return {
        published: false,
        reason: "previous-publish-confirmation-pending",
      } as const;
    }

    const walletRows =
      await redis.smembers<string[]>(
        pendingWalletsKey(mintString),
      );

    const wallets = Array.isArray(walletRows)
      ? walletRows.slice(0, MAX_BATCH_WALLETS)
      : [];

    if (wallets.length === 0) {
      return {
        published: false,
        reason: "no-pending-wallets",
      } as const;
    }

    const pendingValues = await Promise.all(
      wallets.map((wallet) =>
        readInt(
          pendingKey(mintString, wallet),
        ),
      ),
    );

    const rows = wallets
      .map((wallet, index) => ({
        wallet,
        amount: pendingValues[index],
      }))
      .filter(
        (row) =>
          Number.isSafeInteger(row.amount) &&
          row.amount > 0,
      );

    if (rows.length === 0) {
      return {
        published: false,
        reason: "no-positive-rewards",
      } as const;
    }

    const mint = new PublicKey(mintString);
    const authority = authorityKeypair();
    const base = pdas(mint);

    const epochId =
      await nextEpochId(base.config);

    const {
      root,
      allocations,
    } = buildMerkleAllocations(
      epochId,
      rows,
    );

    const totalRewards = allocations.reduce(
      (sum, row) =>
        sum + row.amount,
      0,
    );

    if (
      !Number.isSafeInteger(totalRewards) ||
      totalRewards <= 0
    ) {
      throw new Error(
        "Calculated reward epoch total is invalid.",
      );
    }

    const vaultBalance =
      await connection.getBalance(
        base.vault,
        "confirmed",
      );

    const transaction =
      new Transaction();

    if (vaultBalance < totalRewards) {
      const shortfall =
        totalRewards - vaultBalance;

      transaction.add(
        new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            {
              pubkey: authority.publicKey,
              isSigner: true,
              isWritable: true,
            },
            {
              pubkey: mint,
              isSigner: false,
              isWritable: false,
            },
            {
              pubkey: base.config,
              isSigner: false,
              isWritable: true,
            },
            {
              pubkey: base.vault,
              isSigner: false,
              isWritable: true,
            },
            {
              pubkey: SystemProgram.programId,
              isSigner: false,
              isWritable: false,
            },
          ],
          data: Buffer.concat([
            discriminator("deposit"),
            u64(shortfall),
          ]),
        }),
      );
    }

    const epoch = pdas(
      mint,
      epochId,
    ).epoch;

    if (!epoch) {
      throw new Error(
        "Unable to derive rewards epoch PDA.",
      );
    }

    transaction.add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          {
            pubkey: authority.publicKey,
            isSigner: true,
            isWritable: true,
          },
          {
            pubkey: mint,
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: base.config,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: base.vault,
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: epoch,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
        ],
        data: Buffer.concat([
          discriminator("publish_epoch"),
          u64(epochId),
          root,
          u64(totalRewards),
          i64(0),
        ]),
      }),
    );

    transaction.feePayer =
      authority.publicKey;

    transaction.recentBlockhash =
      (
        await connection.getLatestBlockhash(
          "confirmed",
        )
      ).blockhash;

    transaction.sign(authority);

    const inflightAllocations =
      allocations.map(
        (allocation) => {
          const claimPdas = pdas(
            mint,
            epochId,
            allocation.publicKey,
          );

          if (
            !claimPdas.epoch ||
            !claimPdas.receipt
          ) {
            throw new Error(
              "Unable to derive published claim accounts.",
            );
          }

          return {
            wallet:
              allocation.wallet,
            amount:
              allocation.amount,
            epoch:
              claimPdas.epoch.toBase58(),
            receipt:
              claimPdas.receipt.toBase58(),
            proof:
              allocation.proof.map(
                (node) =>
                  node.toString("base64"),
              ),
          };
        },
      );

    const inflight: PublishInflight = {
      epochId:
        epochId.toString(),
      mint:
        mintString,
      createdAt:
        Date.now(),
      allocations:
        inflightAllocations,
    };

    // Atomically reserve the exact amounts and persist
    // the inflight epoch before broadcasting anything.
    await reserveInflightRewards(
      inflight,
    );

    let publishSignature = "";

    try {
      publishSignature =
        await connection.sendRawTransaction(
          transaction.serialize(),
          {
            skipPreflight: false,
            maxRetries: 3,
          },
        );

      inflight.signature =
        publishSignature;

      await persistInflightSignature(
        inflight,
      );

      await connection.confirmTransaction(
        publishSignature,
        "confirmed",
      );

      await finalizePublishedEpoch(
        inflight,
      );
    } catch (error) {
      /*
       * Do not immediately restore a reserved epoch after a
       * broadcast/confirmation error. A network error can be
       * ambiguous: Solana may have accepted the transaction even
       * if this server never received the signature/confirmation.
       * The durable inflight reconciler checks the epoch PDA and
       * waits out the uncertainty window before restoring funds.
       */
      throw error;
    }

    return {
      published: true,
      epochId:
        epochId.toString(),
      walletCount:
        allocations.length,
      totalRewards,
      totalRewardsSol:
        totalRewards /
        LAMPORTS_PER_SOL,
      signature:
        publishSignature,
    } as const;
  } finally {
    await releasePublishLock(
      mintString,
      lockToken,
    );
  }
}

export async function prepareOnchainClaim(
  mintString: string,
  walletString: string,
) {
  if (!KODIAK_IS_DEVNET) {
    throw new Error(
      "On-chain holder rewards are currently Devnet-only.",
    );
  }

  // Fallback publisher: if a trade's background
  // publish failed, opening a claim will retry it.
  try {
    await publishPendingRewardsEpoch(
      mintString,
    );
  } catch (error) {
    console.error(
      "Fallback holder reward publish failed:",
      error,
    );
  }

  const mint = new PublicKey(mintString);
  const claimant =
    new PublicKey(walletString);

  const activeClaims =
    await readActiveClaims(
      mintString,
      walletString,
    );

  const active = activeClaims[0];

  if (!active) {
    throw new Error(
      "This wallet has no published SOL rewards to claim yet.",
    );
  }

  return buildClaimTransaction(
    mint,
    claimant,
    active,
  );
}

async function buildClaimTransaction(
  mint: PublicKey,
  claimant: PublicKey,
  active: ActiveClaim,
) {
  const epochId =
    BigInt(active.epochId);

  const amount =
    BigInt(active.amount);

  const {
    config,
    vault,
    epoch,
    receipt,
  } = pdas(
    mint,
    epochId,
    claimant,
  );

  if (!epoch || !receipt) {
    throw new Error(
      "Unable to derive claim accounts.",
    );
  }

  if (
    epoch.toBase58() !== active.epoch ||
    receipt.toBase58() !== active.receipt
  ) {
    throw new Error(
      "Stored reward claim accounts are invalid.",
    );
  }

  const proof = active.proof.map(
    (value) =>
      Buffer.from(value, "base64"),
  );

  const transaction =
    new Transaction().add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          {
            pubkey: claimant,
            isSigner: true,
            isWritable: true,
          },
          {
            pubkey: mint,
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: config,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: epoch,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: vault,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: receipt,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
        ],
        data: Buffer.concat([
          discriminator("claim"),
          u64(epochId),
          u64(amount),
          encodeProof(proof),
        ]),
      }),
    );

  transaction.feePayer =
    claimant;

  transaction.recentBlockhash =
    (
      await connection.getLatestBlockhash(
        "confirmed",
      )
    ).blockhash;

  return {
    transaction:
      transaction
        .serialize({
          requireAllSignatures: false,
        })
        .toString("base64"),
    epochId:
      active.epochId,
    amount:
      active.amount,
  };
}

export async function finalizeOnchainClaim(
  mint: string,
  wallet: string,
  signature: string,
) {
  const redis = getRedis();

  const activeClaims =
    await readActiveClaims(
      mint,
      wallet,
    );

  const active =
    activeClaims[0];

  if (!active) {
    throw new Error(
      "No active on-chain claim was found for this wallet.",
    );
  }

  const parsed =
    await connection.getParsedTransaction(
      signature,
      {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      },
    );

  if (!parsed || parsed.meta?.err) {
    throw new Error(
      "The claim transaction is not confirmed successfully on Devnet.",
    );
  }

  if (
    !parsed.transaction.message.accountKeys.some(
      (key) =>
        key.pubkey.toBase58() ===
        active.receipt,
    )
  ) {
    throw new Error(
      "The confirmed transaction does not match this rewards claim.",
    );
  }

  const pipeline =
    redis.pipeline();

  pipeline.incrby(
    claimedKey(mint, wallet),
    active.amount,
  );

  pipeline.incrby(
    totalClaimedKey(mint),
    active.amount,
  );

  pipeline.lpop(
    activeClaimsKey(
      mint,
      wallet,
    ),
  );

  await pipeline.exec();

  return {
    signature,
    lamports:
      active.amount,
    sol:
      active.amount /
      LAMPORTS_PER_SOL,
    remainingPublishedClaims:
      Math.max(
        0,
        activeClaims.length - 1,
      ),
  };
}
