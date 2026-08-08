import { Connection, PublicKey } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  Curve,
  DEVNET_PROGRAM_ID,
  getPdaLaunchpadPoolId,
  LaunchpadConfig,
  LaunchpadPool,
} from "@raydium-io/raydium-sdk-v2";

export type StoredTrade = {
  mint: string;
  wallet: string;
  signature: string;
  side: "buy" | "sell";
  solAmount: number;
  tokenAmount: number;
  priceSol: number;
  openPriceSol?: number;
  closePriceSol?: number;
  timestamp: number;
};

type InferredTrade = {
  tokenAmount: number;
  timestamp: number;
  openPriceSol?: number;
  closePriceSol?: number;
};

type TokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  amount: number;
};

const connection = new Connection(
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    process.env.SOLANA_RPC_URL ||
    "https://api.devnet.solana.com",
  "confirmed",
);

function redisConfig() {
  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("Redis REST environment variables are missing.");
  }

  return {
    url: url.replace(/\/$/, ""),
    token,
  };
}

async function redis<T = unknown>(command: unknown[]): Promise<T> {
  const { url, token } = redisConfig();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Redis request failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    result?: T;
    error?: string;
  };

  if (payload.error) {
    throw new Error(payload.error);
  }

  return payload.result as T;
}

const tradeKey = (mint: string) =>
  `kodiak:devnet:trades:${mint}`;

const signatureKey = (mint: string) =>
  `kodiak:devnet:trade-signatures:${mint}`;

function balanceAmount(value: {
  uiTokenAmount?: {
    uiAmountString?: string | null;
    amount?: string;
    decimals?: number;
  };
}) {
  const uiAmountString = value.uiTokenAmount?.uiAmountString;

  if (uiAmountString != null) {
    const parsed = Number(uiAmountString);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const raw = Number(value.uiTokenAmount?.amount ?? "0");
  const decimals = Number(value.uiTokenAmount?.decimals ?? 0);

  if (!Number.isFinite(raw) || !Number.isFinite(decimals)) {
    return 0;
  }

  return raw / 10 ** decimals;
}

function collectBalances(
  rows:
    | Array<{
        accountIndex: number;
        mint: string;
        owner?: string;
        uiTokenAmount: {
          uiAmountString?: string | null;
          amount: string;
          decimals: number;
        };
      }>
    | null
    | undefined,
): TokenBalance[] {
  return (rows ?? []).map((row) => ({
    accountIndex: row.accountIndex,
    mint: row.mint,
    owner: row.owner,
    amount: balanceAmount(row),
  }));
}

function deltaForAccount(
  pre: TokenBalance[],
  post: TokenBalance[],
  accountIndex: number,
  mint: string,
) {
  const before =
    pre.find(
      (row) =>
        row.accountIndex === accountIndex &&
        row.mint === mint,
    )?.amount ?? 0;

  const after =
    post.find(
      (row) =>
        row.accountIndex === accountIndex &&
        row.mint === mint,
    )?.amount ?? 0;

  return {
    before,
    after,
    delta: after - before,
  };
}

function findLargestPositiveDelta(
  pre: TokenBalance[],
  post: TokenBalance[],
  mint: string,
  owner?: string,
) {
  const indexes = new Set<number>();

  for (const row of [...pre, ...post]) {
    if (row.mint !== mint) continue;
    if (owner && row.owner !== owner) continue;
    indexes.add(row.accountIndex);
  }

  let best:
    | {
        accountIndex: number;
        before: number;
        after: number;
        delta: number;
      }
    | undefined;

  for (const accountIndex of indexes) {
    const delta = deltaForAccount(
      pre,
      post,
      accountIndex,
      mint,
    );

    if (delta.delta <= 0) continue;

    if (!best || delta.delta > best.delta) {
      best = {
        accountIndex,
        ...delta,
      };
    }
  }

  return best;
}

function findLargestNegativeDelta(
  pre: TokenBalance[],
  post: TokenBalance[],
  mint: string,
) {
  const indexes = new Set<number>();

  for (const row of [...pre, ...post]) {
    if (row.mint === mint) {
      indexes.add(row.accountIndex);
    }
  }

  let best:
    | {
        accountIndex: number;
        before: number;
        after: number;
        delta: number;
      }
    | undefined;

  for (const accountIndex of indexes) {
    const delta = deltaForAccount(
      pre,
      post,
      accountIndex,
      mint,
    );

    if (delta.delta >= 0) continue;

    if (!best || delta.delta < best.delta) {
      best = {
        accountIndex,
        ...delta,
      };
    }
  }

  return best;
}

async function readLaunchpadCurvePrices(
  mint: string,
): Promise<{
  openPriceSol?: number;
  closePriceSol?: number;
}> {
  try {
    const mintA = new PublicKey(mint);
    const poolId = getPdaLaunchpadPoolId(
      DEVNET_PROGRAM_ID.LAUNCHPAD_PROGRAM,
      mintA,
      NATIVE_MINT,
    ).publicKey;

    const poolAccount = await connection.getAccountInfo(
      poolId,
      "confirmed",
    );

    if (!poolAccount) {
      return {};
    }

    const poolInfo = LaunchpadPool.decode(poolAccount.data);

    const configAccount = await connection.getAccountInfo(
      poolInfo.configId,
      "confirmed",
    );

    if (!configAccount) {
      return {};
    }

    const configInfo = LaunchpadConfig.decode(
      configAccount.data,
    );

    const closePriceSol = Curve.getPrice({
      poolInfo,
      curveType: configInfo.curveType,
      decimalA: poolInfo.mintDecimalsA,
      decimalB: poolInfo.mintDecimalsB,
    }).toNumber();

    if (
      !Number.isFinite(closePriceSol) ||
      closePriceSol <= 0
    ) {
      return {};
    }

    return { closePriceSol };
  } catch (error) {
    console.error(
      "Unable to read official LaunchLab curve price:",
      error,
    );
    return {};
  }
}

export async function inferTokenAmount(
  signature: string,
  mint: string,
  wallet: string,
): Promise<InferredTrade> {
  const parsed = await connection.getParsedTransaction(
    signature,
    {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    },
  );

  if (!parsed) {
    return {
      tokenAmount: 0,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  const owner = new PublicKey(wallet).toBase58();
  const pre = collectBalances(parsed.meta?.preTokenBalances);
  const post = collectBalances(parsed.meta?.postTokenBalances);

  const ownerIncrease =
    findLargestPositiveDelta(pre, post, mint, owner);

  const anyIncrease =
    ownerIncrease ??
    findLargestPositiveDelta(pre, post, mint);

  const tokenAmount = Math.abs(anyIncrease?.delta ?? 0);

  const tokenReserve =
    findLargestNegativeDelta(pre, post, mint);

  const quoteMint = NATIVE_MINT.toBase58();
  const quoteReserve =
    findLargestPositiveDelta(pre, post, quoteMint);

  let openPriceSol: number | undefined;
  let closePriceSol: number | undefined;

  if (
    tokenReserve &&
    quoteReserve &&
    tokenReserve.before > 0 &&
    tokenReserve.after > 0 &&
    quoteReserve.before >= 0 &&
    quoteReserve.after > 0
  ) {
    const before =
      quoteReserve.before / tokenReserve.before;
    const after =
      quoteReserve.after / tokenReserve.after;

    if (Number.isFinite(before) && before > 0) {
      openPriceSol = before;
    }

    if (Number.isFinite(after) && after > 0) {
      closePriceSol = after;
    }
  }

  const curvePrices =
    await readLaunchpadCurvePrices(mint);

  return {
    tokenAmount,
    timestamp:
      parsed.blockTime ??
      Math.floor(Date.now() / 1000),
    openPriceSol:
      curvePrices.openPriceSol ?? openPriceSol,
    closePriceSol:
      curvePrices.closePriceSol ?? closePriceSol,
  };
}

export async function saveTrade(trade: StoredTrade) {
  const added = await redis<number>([
    "SADD",
    signatureKey(trade.mint),
    trade.signature,
  ]);

  if (added === 0) {
    const existing = await getTrades(trade.mint);
    return (
      existing.find(
        (row) => row.signature === trade.signature,
      ) ?? trade
    );
  }

  const key = tradeKey(trade.mint);

  await redis([
    "RPUSH",
    key,
    JSON.stringify(trade),
  ]);

  await redis([
    "LTRIM",
    key,
    -5000,
    -1,
  ]);

  return trade;
}

export async function getTrades(
  mint: string,
): Promise<StoredTrade[]> {
  const rows = await redis<string[]>([
    "LRANGE",
    tradeKey(mint),
    0,
    -1,
  ]);

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map((row) => {
      try {
        return JSON.parse(row) as StoredTrade;
      } catch {
        return null;
      }
    })
    .filter(
      (row): row is StoredTrade => Boolean(row),
    )
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function buildCandles(
  trades: StoredTrade[],
  intervalSeconds: number,
) {
  const buckets = new Map<
    number,
    {
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }
  >();

  let previousClose = 0;

  for (const trade of trades) {
    const executionPrice = Number(trade.priceSol);
    const eventOpen = Number(
      trade.openPriceSol ?? previousClose ?? executionPrice,
    );
    const eventClose = Number(
      trade.closePriceSol ?? executionPrice,
    );

    if (
      !Number.isFinite(eventClose) ||
      eventClose <= 0
    ) {
      continue;
    }

    const safeOpen =
      Number.isFinite(eventOpen) && eventOpen > 0
        ? eventOpen
        : eventClose;

    const time =
      Math.floor(trade.timestamp / intervalSeconds) *
      intervalSeconds;

    /*
     * Candles represent the bonding-curve spot price path.
     *
     * trade.priceSol is the average execution price across the trade.
     * That average can sit below the post-sell spot price (or above the
     * post-buy spot price), so including it in candle high/low creates
     * misleading long wicks.
     *
     * Use only the stored pre-trade and post-trade spot prices for OHLC.
     * executionPrice remains available on the trade record for analytics.
     */
    const eventHigh = Math.max(
      safeOpen,
      eventClose,
    );

    const eventLow = Math.min(
      safeOpen,
      eventClose,
    );

    const current = buckets.get(time);

    if (!current) {
      buckets.set(time, {
        time,
        open: safeOpen,
        high: eventHigh,
        low: eventLow,
        close: eventClose,
        volume: Number(trade.solAmount || 0),
      });
    } else {
      current.high = Math.max(
        current.high,
        eventHigh,
      );
      current.low = Math.min(
        current.low,
        eventLow,
      );
      current.close = eventClose;
      current.volume += Number(
        trade.solAmount || 0,
      );
    }

    previousClose = eventClose;
  }

  return [...buckets.values()].sort(
    (a, b) => a.time - b.time,
  );
}
