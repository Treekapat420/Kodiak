import "server-only";

import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  ParsedAccountData,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import type { StoredTrade } from "@/lib/devnet-market";
import { getRedis } from "@/lib/server/redis";
import {
  KODIAK_IS_DEVNET,
  KODIAK_NETWORK,
  KODIAK_RPC_URL,
} from "@/lib/solana/network";

export const KODIAK_HOLDER_REWARD_BPS = 25;
export const KODIAK_CREATOR_RETAINED_BPS = 20;

const connection = new Connection(
  process.env.SOLANA_DEVNET_RPC_URL?.trim() ||
    process.env.SOLANA_RPC_URL?.trim() ||
    KODIAK_RPC_URL,
  "confirmed",
);

function configuredOfficialMint() {
  return process.env.NEXT_PUBLIC_KODIAK_OFFICIAL_DEVNET_MINT?.trim() ?? "";
}

export function getOfficialKodiakDevnetMint(): string | null {
  if (!KODIAK_IS_DEVNET) return null;

  const value = configuredOfficialMint();
  if (!value) return null;

  try {
    const key = new PublicKey(value);
    return key.toBase58() === value ? value : null;
  } catch {
    return null;
  }
}

export function isOfficialKodiakRewardsMint(mint: string) {
  const officialMint = getOfficialKodiakDevnetMint();
  return Boolean(officialMint && officialMint === mint && KODIAK_IS_DEVNET);
}

function rewardPrefix(mint: string) {
  return `kodiak:${KODIAK_NETWORK}:holder-rewards:${mint}`;
}

function pendingKey(mint: string, wallet: string) {
  return `${rewardPrefix(mint)}:pending:${wallet}`;
}

function claimedKey(mint: string, wallet: string) {
  return `${rewardPrefix(mint)}:claimed:${wallet}`;
}

function tradeMarkerKey(mint: string, signature: string) {
  return `${rewardPrefix(mint)}:trade:${signature}`;
}

function eventListKey(mint: string) {
  return `${rewardPrefix(mint)}:events`;
}

function totalGeneratedKey(mint: string) {
  return `${rewardPrefix(mint)}:generated-lamports`;
}

function totalClaimedKey(mint: string) {
  return `${rewardPrefix(mint)}:claimed-lamports`;
}

function claimNonceKey(mint: string, wallet: string) {
  return `${rewardPrefix(mint)}:nonce:${wallet}`;
}

function claimInflightKey(mint: string, wallet: string) {
  return `${rewardPrefix(mint)}:claim-inflight:${wallet}`;
}

function excludedWallets() {
  return new Set(
    (process.env.KODIAK_DEVNET_REWARDS_EXCLUDED_WALLETS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

type Holder = {
  wallet: string;
  rawAmount: bigint;
};

async function loadEligibleHolders(mint: string): Promise<Holder[]> {
  const mintKey = new PublicKey(mint);
  const accounts = await connection.getParsedProgramAccounts(TOKEN_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [
      { dataSize: 165 },
      { memcmp: { offset: 0, bytes: mintKey.toBase58() } },
    ],
  });

  const excluded = excludedWallets();
  const balances = new Map<string, bigint>();

  for (const row of accounts) {
    const data = row.account.data;
    if (!("parsed" in data)) continue;

    const parsed = data as ParsedAccountData;
    const info = parsed.parsed?.info as
      | {
          owner?: string;
          tokenAmount?: { amount?: string };
        }
      | undefined;

    const owner = info?.owner?.trim() ?? "";
    const raw = info?.tokenAmount?.amount ?? "0";

    if (!owner || excluded.has(owner)) continue;

    let ownerKey: PublicKey;
    try {
      ownerKey = new PublicKey(owner);
    } catch {
      continue;
    }

    // Token vault authorities and AMM/LaunchLab PDAs are not holder wallets.
    if (!PublicKey.isOnCurve(ownerKey.toBytes())) continue;

    let amount: bigint;
    try {
      amount = BigInt(raw);
    } catch {
      continue;
    }

    if (amount <= 0n) continue;
    balances.set(owner, (balances.get(owner) ?? 0n) + amount);
  }

  return Array.from(balances, ([wallet, rawAmount]) => ({ wallet, rawAmount }));
}

export async function recordOfficialKodiakHolderRewards(trade: StoredTrade) {
  if (!isOfficialKodiakRewardsMint(trade.mint)) return null;

  const redis = getRedis();
  const marker = tradeMarkerKey(trade.mint, trade.signature);
  const markerCreated = await redis.set(marker, "processing", { nx: true });

  if (!markerCreated) return null;

  try {
    const rewardLamports = Math.floor(
      trade.solAmount * LAMPORTS_PER_SOL * (KODIAK_HOLDER_REWARD_BPS / 10_000),
    );

    if (!Number.isSafeInteger(rewardLamports) || rewardLamports <= 0) {
      await redis.set(marker, "zero");
      return null;
    }

    const holders = await loadEligibleHolders(trade.mint);
    const totalRaw = holders.reduce((sum, holder) => sum + holder.rawAmount, 0n);

    if (holders.length === 0 || totalRaw <= 0n) {
      await redis.del(marker);
      return null;
    }

    const rewardBig = BigInt(rewardLamports);
    let distributed = 0;
    let largestWallet = holders[0].wallet;
    let largestAmount = holders[0].rawAmount;

    const allocations = holders.map((holder) => {
      if (holder.rawAmount > largestAmount) {
        largestAmount = holder.rawAmount;
        largestWallet = holder.wallet;
      }

      const lamports = Number((rewardBig * holder.rawAmount) / totalRaw);
      distributed += lamports;
      return { wallet: holder.wallet, lamports };
    });

    const remainder = rewardLamports - distributed;
    if (remainder > 0) {
      const largest = allocations.find((item) => item.wallet === largestWallet);
      if (largest) largest.lamports += remainder;
    }

    const pipeline = redis.pipeline();

    for (const allocation of allocations) {
      if (allocation.lamports > 0) {
        pipeline.incrby(pendingKey(trade.mint, allocation.wallet), allocation.lamports);
      }
    }

    pipeline.incrby(totalGeneratedKey(trade.mint), rewardLamports);
    pipeline.lpush(
      eventListKey(trade.mint),
      JSON.stringify({
        signature: trade.signature,
        side: trade.side,
        solAmount: trade.solAmount,
        rewardLamports,
        holderCount: holders.length,
        timestamp: trade.timestamp,
      }),
    );
    pipeline.ltrim(eventListKey(trade.mint), 0, 499);
    pipeline.set(
      marker,
      JSON.stringify({ rewardLamports, holderCount: holders.length, at: Date.now() }),
    );

    await pipeline.exec();

    return { rewardLamports, holderCount: holders.length };
  } catch (error) {
    await redis.del(marker);
    throw error;
  }
}

function rewardKeypair(): Keypair | null {
  const raw = process.env.KODIAK_DEVNET_REWARDS_SECRET_KEY?.trim();
  if (!raw || !KODIAK_IS_DEVNET) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 64) return null;

    const bytes = Uint8Array.from(parsed.map((value) => Number(value)));
    return Keypair.fromSecretKey(bytes);
  } catch {
    return null;
  }
}

export function getRewardsVaultPublicKey() {
  return rewardKeypair()?.publicKey.toBase58() ?? null;
}

async function readInteger(key: string) {
  const value = await getRedis().get<string | number>(key);
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export async function getHolderRewardStatus(mint: string, wallet?: string) {
  if (!isOfficialKodiakRewardsMint(mint)) {
    return {
      enabled: false,
      network: KODIAK_NETWORK,
      officialMint: getOfficialKodiakDevnetMint(),
    } as const;
  }

  const keypair = rewardKeypair();
  const [vaultLamports, generatedLamports, totalClaimedLamports] = await Promise.all([
    keypair ? connection.getBalance(keypair.publicKey, "confirmed") : Promise.resolve(0),
    readInteger(totalGeneratedKey(mint)),
    readInteger(totalClaimedKey(mint)),
  ]);

  let claimableLamports = 0;
  let lifetimeClaimedLamports = 0;
  let tokenBalanceRaw = "0";

  if (wallet) {
    const walletKey = new PublicKey(wallet);
    const [pending, claimed, tokenAccounts] = await Promise.all([
      readInteger(pendingKey(mint, wallet)),
      readInteger(claimedKey(mint, wallet)),
      connection.getParsedTokenAccountsByOwner(walletKey, { mint: new PublicKey(mint) }),
    ]);

    claimableLamports = pending;
    lifetimeClaimedLamports = claimed;
    tokenBalanceRaw = tokenAccounts.value
      .reduce((sum, row) => {
        const data = row.account.data;
        if (!("parsed" in data)) return sum;
        const amount = (data as ParsedAccountData).parsed?.info?.tokenAmount?.amount;
        try {
          return sum + BigInt(amount ?? "0");
        } catch {
          return sum;
        }
      }, 0n)
      .toString();
  }

  return {
    enabled: true,
    network: KODIAK_NETWORK,
    officialMint: mint,
    holderRewardBps: KODIAK_HOLDER_REWARD_BPS,
    creatorRetainedBps: KODIAK_CREATOR_RETAINED_BPS,
    vaultConfigured: Boolean(keypair),
    vault: keypair?.publicKey.toBase58() ?? null,
    vaultLamports,
    vaultSol: vaultLamports / LAMPORTS_PER_SOL,
    generatedLamports,
    generatedSol: generatedLamports / LAMPORTS_PER_SOL,
    totalClaimedLamports,
    totalClaimedSol: totalClaimedLamports / LAMPORTS_PER_SOL,
    wallet: wallet ?? null,
    tokenBalanceRaw,
    eligible: Boolean(wallet && BigInt(tokenBalanceRaw) > 0n),
    claimableLamports,
    claimableSol: claimableLamports / LAMPORTS_PER_SOL,
    lifetimeClaimedLamports,
    lifetimeClaimedSol: lifetimeClaimedLamports / LAMPORTS_PER_SOL,
  } as const;
}

export async function createClaimChallenge(mint: string, wallet: string) {
  if (!isOfficialKodiakRewardsMint(mint)) {
    throw new Error("SOL holder rewards are only enabled for the official Devnet $KODIAK token.");
  }

  const walletKey = new PublicKey(wallet);
  if (walletKey.toBase58() !== wallet) throw new Error("Invalid wallet address.");

  const nonce = crypto.randomUUID();
  const message = [
    "Kodiak SOL Rewards claim",
    "network:devnet",
    `mint:${mint}`,
    `wallet:${wallet}`,
    `nonce:${nonce}`,
  ].join("\n");

  await getRedis().set(claimNonceKey(mint, wallet), nonce, { ex: 300 });
  return { nonce, message };
}

export async function consumeClaimNonce(mint: string, wallet: string, nonce: string) {
  const redis = getRedis();
  const key = claimNonceKey(mint, wallet);
  const expected = await redis.get<string>(key);

  if (!expected || expected !== nonce) return false;
  await redis.del(key);
  return true;
}

export async function sendHolderRewardClaim(mint: string, wallet: string) {
  if (!isOfficialKodiakRewardsMint(mint)) {
    throw new Error("SOL holder rewards are only enabled for the official Devnet $KODIAK token.");
  }

  const keypair = rewardKeypair();
  if (!keypair) throw new Error("The Devnet SOL rewards vault is not configured yet.");

  const destination = new PublicKey(wallet);
  const redis = getRedis();
  const inflightKey = claimInflightKey(mint, wallet);
  const created = await redis.set(inflightKey, "reserving", { nx: true });
  if (!created) throw new Error("A SOL reward claim for this wallet is already being processed.");

  let reserved = 0;
  let pendingWasReserved = false;
  let broadcasted = false;

  try {
    reserved = await readInteger(pendingKey(mint, wallet));
    if (reserved <= 0) throw new Error("This wallet has no claimable SOL rewards yet.");

    const vaultBalance = await connection.getBalance(keypair.publicKey, "confirmed");
    const feeReserve = 10_000;
    if (vaultBalance < reserved + feeReserve) {
      throw new Error("The Devnet rewards vault needs more SOL before this claim can be paid.");
    }

    // Reserve the full pending amount before broadcasting. If execution crashes
    // after broadcast, the durable inflight record prevents a duplicate payout.
    await redis.set(pendingKey(mint, wallet), 0);
    pendingWasReserved = true;
    await redis.set(
      inflightKey,
      JSON.stringify({ lamports: reserved, startedAt: Date.now() }),
    );

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: destination,
        lamports: reserved,
      }),
    );
    transaction.feePayer = keypair.publicKey;
    transaction.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
    transaction.sign(keypair);

    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    broadcasted = true;
    await redis.set(
      inflightKey,
      JSON.stringify({ lamports: reserved, signature, startedAt: Date.now() }),
    );
    await connection.confirmTransaction(signature, "confirmed");

    const pipeline = redis.pipeline();
    pipeline.incrby(claimedKey(mint, wallet), reserved);
    pipeline.incrby(totalClaimedKey(mint), reserved);
    pipeline.del(inflightKey);
    await pipeline.exec();

    return { signature, lamports: reserved, sol: reserved / LAMPORTS_PER_SOL };
  } catch (error) {
    if (!broadcasted) {
      if (pendingWasReserved && reserved > 0) {
        await redis.incrby(pendingKey(mint, wallet), reserved);
      }
      await redis.del(inflightKey);
    }
    // If the transaction was broadcast but confirmation failed, leave the
    // durable inflight reservation intact. That fails safe against a duplicate
    // payout until the signature can be reconciled.
    throw error;
  }
}
