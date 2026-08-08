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
  slot?: number;
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function findOwnerTokenDelta(
  pre: TokenBalance[],
  post: TokenBalance[],
  mint: string,
  owner: string,
) {
  const indexes = new Set<number>();

  for (const row of [...pre, ...post]) {
    if (row.mint !== mint) continue;
    if (row.owner !== owner) continue;
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
    const next = deltaForAccount(
      pre,
      post,
      accountIndex,
      mint,
    );

    if (next.delta === 0) continue;

    if (
      !best ||
      Math.abs(next.delta) > Math.abs(best.delta)
    ) {
      best = {
        accountIndex,
        ...next,
      };
    }
  }

  return best;
}

function findPoolTokenDelta(
  pre: TokenBalance[],
  post: TokenBalance[],
  mint: string,
  side: "buy" | "sell",
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
    const next = deltaForAccount(
      pre,
      post,
      accountIndex,
      mint,
    );

    const directionMatches =
      side === "buy"
        ? next.delta < 0
        : next.delta > 0;

    if (!directionMatches) continue;

    if (
      !best ||
      Math.abs(next.delta) > Math.abs(best.delta)
    ) {
      best = {
        accountIndex,
        ...next,
      };
    }
  }

  return best;
}

async function readLaunchpadCurvePrices(
  mint: string,
  minContextSlot: number,
): Promise<{
  openPriceSol?: number;
  closePriceSol?: number;
}> {
  const mintA = new PublicKey(mint);
  const poolId = getPdaLaunchpadPoolId(
    DEVNET_PROGRAM_ID.LAUNCHPAD_PROGRAM,
    mintA,
    NATIVE_MINT,
  ).publicKey;

  let lastError: unknown;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const poolAccount = await connection.getAccountInfo(
        poolId,
        {
          commitment: "confirmed",
          minContextSlot,
        },
      );

      if (!poolAccount) {
        throw new Error("LaunchLab pool account is not available yet.");
      }

      const poolInfo = LaunchpadPool.decode(poolAccount.data);

      const configAccount = await connection.getAccountInfo(
        poolInfo.configId,
        {
          commitment: "confirmed",
          minContextSlot,
        },
      );

      if (!configAccount) {
        throw new Error("LaunchLab config account is not available yet.");
      }

      const configInfo = LaunchpadConfig.decode(
        configAccount.data,
      );

      const openPriceSol = Curve.getPoolInitPriceByPool({
        poolInfo,
        curveType: configInfo.curveType,
        decimalA: poolInfo.mintDecimalsA,
        decimalB: poolInfo.mintDecimalsB,
      }).toNumber();

      const closePriceSol = Curve.getPrice({
        poolInfo,
        curveType: configInfo.curveType,
        decimalA: poolInfo.mintDecimalsA,
        decimalB: poolInfo.mintDecimalsB,
      }).toNumber();

      if (
        !Number.isFinite(openPriceSol) ||
        !Number.isFinite(closePriceSol) ||
        openPriceSol <= 0 ||
        closePriceSol <= 0
      ) {
        throw new Error(
          "LaunchLab returned an invalid bonding-curve spot price.",
        );
      }

      return {
        openPriceSol,
        closePriceSol,
      };
    } catch (error) {
      lastError = error;

      if (attempt < 5) {
        await sleep(700 + attempt * 350);
      }
    }
  }

  console.error(
    "Unable to read confirmed LaunchLab curve state:",
    lastError,
  );

  return {};
}

export async function inferTokenAmount(
  signature: string,
  mint: string,
  wallet: string,
  side: "buy" | "sell" = "buy",
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

  if (parsed.meta?.err) {
    return {
      tokenAmount: 0,
      timestamp:
        parsed.blockTime ??
        Math.floor(Date.now() / 1000),
      slot: parsed.slot,
    };
  }

  const owner = new PublicKey(wallet).toBase58();
  const pre = collectBalances(parsed.meta?.preTokenBalances);
  const post = collectBalances(parsed.meta?.postTokenBalances);

  const ownerDelta = findOwnerTokenDelta(
    pre,
    post,
    mint,
    owner,
  );

  const ownerDirectionMatches = ownerDelta
    ? side === "buy"
      ? ownerDelta.delta > 0
      : ownerDelta.delta < 0
    : false;

  const poolDelta = findPoolTokenDelta(
    pre,
    post,
    mint,
    side,
  );

  const tokenAmount = Math.abs(
    ownerDirectionMatches
      ? ownerDelta?.delta ?? 0
      : poolDelta?.delta ?? 0,
  );

  if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) {
    return {
      tokenAmount: 0,
      timestamp:
        parsed.blockTime ??
        Math.floor(Date.now() / 1000),
      slot: parsed.slot,
    };
  }

  /*
   * IMPORTANT:
   * Do not calculate chart prices from ordinary SPL-token vault balances.
   * LaunchLab pricing uses virtual reserves, so a WSOL/token account ratio
   * is not the bonding-curve spot price.
   *
   * Read Raydium's actual decoded LaunchpadPool instead. minContextSlot
   * prevents this server from accepting pool state older than the confirmed
   * trade transaction.
   */
  const curvePrices = await readLaunchpadCurvePrices(
    mint,
    parsed.slot,
  );

  return {
    tokenAmount,
    timestamp:
      parsed.blockTime ??
      Math.floor(Date.now() / 1000),
    openPriceSol: curvePrices.openPriceSol,
    closePriceSol: curvePrices.closePriceSol,
    slot: parsed.slot,
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
    const storedOpen = Number(trade.openPriceSol);
    const storedClose = Number(trade.closePriceSol);

    if (
      !Number.isFinite(storedClose) ||
      storedClose <= 0
    ) {
      continue;
    }

    const eventOpen =
      Number.isFinite(previousClose) && previousClose > 0
        ? previousClose
        : Number.isFinite(storedOpen) && storedOpen > 0
          ? storedOpen
          : 0;

    if (!Number.isFinite(eventOpen) || eventOpen <= 0) {
      continue;
    }

    /*
     * A LaunchLab bonding-curve buy must move spot price upward.
     * A sell must move it downward.
     *
     * If an old/stale stored record violates that invariant, do not turn it
     * into a fake candle. New trades are rejected by the POST route before
     * they can be saved in this state.
     */
    const directionIsValid =
      trade.side === "buy"
        ? storedClose > eventOpen
        : storedClose < eventOpen;

    if (!directionIsValid) {
      continue;
    }

    const time =
      Math.floor(trade.timestamp / intervalSeconds) *
      intervalSeconds;

    const eventHigh = Math.max(
      eventOpen,
      storedClose,
    );

    const eventLow = Math.min(
      eventOpen,
      storedClose,
    );

    const current = buckets.get(time);

    if (!current) {
      buckets.set(time, {
        time,
        open: eventOpen,
        high: eventHigh,
        low: eventLow,
        close: storedClose,
        volume: Math.abs(Number(trade.solAmount || 0)),
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
      current.close = storedClose;
      current.volume += Math.abs(
        Number(trade.solAmount || 0),
      );
    }

    previousClose = storedClose;
  }

  return [...buckets.values()].sort(
    (a, b) => a.time - b.time,
  );
}
