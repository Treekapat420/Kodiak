import "server-only";

import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Connection,
  LAMPORTS_PER_SOL,
  ParsedAccountData,
  PublicKey,
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

function pendingWalletsKey(mint: string) {
  return `${rewardPrefix(mint)}:pending-wallets`;
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

    if (amount <= BigInt(0)) continue;
    balances.set(owner, (balances.get(owner) ?? BigInt(0)) + amount);
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
    const totalRaw = holders.reduce((sum, holder) => sum + holder.rawAmount, BigInt(0));

    if (holders.length === 0 || totalRaw <= BigInt(0)) {
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
        pipeline.incrby(
          pendingKey(trade.mint, allocation.wallet),
          allocation.lamports,
        );
        pipeline.sadd(
          pendingWalletsKey(trade.mint),
          allocation.wallet,
        );
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

  const [generatedLamports, totalClaimedLamports] = await Promise.all([
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
      }, BigInt(0))
      .toString();
  }

  return {
    enabled: true,
    network: KODIAK_NETWORK,
    officialMint: mint,
    holderRewardBps: KODIAK_HOLDER_REWARD_BPS,
    creatorRetainedBps: KODIAK_CREATOR_RETAINED_BPS,
    generatedLamports,
    generatedSol: generatedLamports / LAMPORTS_PER_SOL,
    totalClaimedLamports,
    totalClaimedSol: totalClaimedLamports / LAMPORTS_PER_SOL,
    wallet: wallet ?? null,
    tokenBalanceRaw,
    eligible: Boolean(wallet && BigInt(tokenBalanceRaw) > BigInt(0)),
    claimableLamports,
    claimableSol: claimableLamports / LAMPORTS_PER_SOL,
    lifetimeClaimedLamports,
    lifetimeClaimedSol: lifetimeClaimedLamports / LAMPORTS_PER_SOL,
  } as const;
}
