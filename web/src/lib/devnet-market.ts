import { Connection, PublicKey } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  CREATE_CPMM_POOL_PROGRAM,
  Curve,
  DEVNET_PROGRAM_ID,
  getPdaLaunchpadPoolId,
  LaunchpadConfig,
  LaunchpadPool,
} from "@raydium-io/raydium-sdk-v2";

import {
  KODIAK_LAUNCHPAD_PROGRAM_ID,
} from "@/lib/raydium/devnet";
import {
  KODIAK_IS_DEVNET,
  KODIAK_IS_MAINNET,
  KODIAK_NETWORK,
  KODIAK_RPC_URL,
} from "@/lib/solana/network";

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
  marketType?: "launchpad" | "cpmm";
};

type InferredTrade = {
  tokenAmount: number;
  quoteAmountSol?: number;
  timestamp: number;
  openPriceSol?: number;
  closePriceSol?: number;
  slot?: number;
  marketType?: "launchpad" | "cpmm";
};

type TokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  amount: number;
};

function serverRpcUrl() {
  if (KODIAK_IS_MAINNET) {
    /*
     * Do not allow a generic RPC variable to silently redirect Mainnet trade
     * verification. network.ts already requires the dedicated Mainnet RPC.
     */
    return (
      process.env.SOLANA_MAINNET_RPC_URL?.trim() ||
      KODIAK_RPC_URL
    );
  }

  return (
    process.env.SOLANA_DEVNET_RPC_URL?.trim() ||
    process.env.SOLANA_RPC_URL?.trim() ||
    KODIAK_RPC_URL
  );
}

const connection = new Connection(
  serverRpcUrl(),
  "confirmed",
);

function getLaunchpadProgramId() {
  /*
   * KODIAK_LAUNCHPAD_PROGRAM_ID is network-aware:
   * - Devnet -> Raydium LaunchLab Devnet program
   * - Mainnet -> Raydium LaunchLab Mainnet program
   *
   * Mainnet remains protected by Kodiak's separate network enable gate.
   * Once that gate is intentionally enabled, chart/trade verification must
   * use the production LaunchLab program instead of refusing Mainnet reads.
   */
  return KODIAK_LAUNCHPAD_PROGRAM_ID;
}

function redisConfig() {
  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL;

  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      "Redis REST environment variables are missing.",
    );
  }

  return {
    url: url.replace(/\/$/, ""),
    token,
  };
}

async function redis<T = unknown>(
  command: unknown[],
): Promise<T> {
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
    throw new Error(
      `Redis request failed: ${response.status}`,
    );
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

/*
 * Keep the existing Devnet Redis key format intact so all current trade
 * history and candles remain available after this refactor.
 *
 * Mainnet naturally uses a separate kodiak:mainnet:* namespace.
 */
const tradeKey = (mint: string) =>
  `kodiak:${KODIAK_NETWORK}:trades:${mint}`;

const signatureKey = (mint: string) =>
  `kodiak:${KODIAK_NETWORK}:trade-signatures:${mint}`;

function sleep(ms: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms),
  );
}

function balanceAmount(value: {
  uiTokenAmount?: {
    uiAmountString?: string | null;
    amount?: string;
    decimals?: number;
  };
}) {
  const uiAmountString =
    value.uiTokenAmount?.uiAmountString;

  if (uiAmountString != null) {
    const parsed = Number(uiAmountString);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const raw = Number(
    value.uiTokenAmount?.amount ?? "0",
  );

  const decimals = Number(
    value.uiTokenAmount?.decimals ?? 0,
  );

  if (
    !Number.isFinite(raw) ||
    !Number.isFinite(decimals)
  ) {
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
      Math.abs(next.delta) >
        Math.abs(best.delta)
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
      Math.abs(next.delta) >
        Math.abs(best.delta)
    ) {
      best = {
        accountIndex,
        ...next,
      };
    }
  }

  return best;
}

function transactionHasProgram(
  parsed: Awaited<
    ReturnType<
      Connection["getParsedTransaction"]
    >
  >,
  programId: PublicKey,
) {
  if (!parsed) {
    return false;
  }

  return parsed.transaction.message.accountKeys.some(
    (account) =>
      account.pubkey.equals(
        programId,
      ),
  );
}

function walletSignedTransaction(
  parsed: NonNullable<
    Awaited<
      ReturnType<
        Connection["getParsedTransaction"]
      >
    >
  >,
  wallet: PublicKey,
) {
  return parsed.transaction.message.accountKeys.some(
    (account) =>
      account.signer &&
      account.pubkey.equals(
        wallet,
      ),
  );
}

function findReserveDelta(
  pre: TokenBalance[],
  post: TokenBalance[],
  mint: string,
  direction: "increase" | "decrease",
  excludedOwner?: string,
) {
  const indexes = new Set<number>();

  for (const row of [...pre, ...post]) {
    if (row.mint !== mint) {
      continue;
    }

    if (
      excludedOwner &&
      row.owner ===
        excludedOwner
    ) {
      continue;
    }

    indexes.add(
      row.accountIndex,
    );
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
    const next =
      deltaForAccount(
        pre,
        post,
        accountIndex,
        mint,
      );

    const matches =
      direction === "increase"
        ? next.delta > 0
        : next.delta < 0;

    if (!matches) {
      continue;
    }

    if (
      !best ||
      Math.abs(
        next.delta,
      ) >
        Math.abs(
          best.delta,
        )
    ) {
      best = {
        accountIndex,
        ...next,
      };
    }
  }

  return best;
}

function cpmmPricesFromTransaction({
  pre,
  post,
  mint,
  owner,
  side,
}: {
  pre: TokenBalance[];
  post: TokenBalance[];
  mint: string;
  owner: string;
  side: "buy" | "sell";
}) {
  const tokenReserve =
    findReserveDelta(
      pre,
      post,
      mint,
      side === "buy"
        ? "decrease"
        : "increase",
      owner,
    );

  const quoteReserve =
    findReserveDelta(
      pre,
      post,
      NATIVE_MINT.toBase58(),
      side === "buy"
        ? "increase"
        : "decrease",
      owner,
    );

  if (
    !tokenReserve ||
    !quoteReserve ||
    tokenReserve.before <= 0 ||
    tokenReserve.after <= 0 ||
    quoteReserve.before <= 0 ||
    quoteReserve.after <= 0
  ) {
    return {};
  }

  const openPriceSol =
    quoteReserve.before /
    tokenReserve.before;

  const closePriceSol =
    quoteReserve.after /
    tokenReserve.after;

  const quoteAmountSol =
    Math.abs(
      quoteReserve.delta,
    );

  if (
    !Number.isFinite(
      openPriceSol,
    ) ||
    !Number.isFinite(
      closePriceSol,
    ) ||
    !Number.isFinite(
      quoteAmountSol,
    ) ||
    openPriceSol <= 0 ||
    closePriceSol <= 0 ||
    quoteAmountSol <= 0
  ) {
    return {};
  }

  return {
    openPriceSol,
    closePriceSol,
    quoteAmountSol,
  };
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
    getLaunchpadProgramId(),
    mintA,
    NATIVE_MINT,
  ).publicKey;

  let lastError: unknown;

  for (
    let attempt = 0;
    attempt < 6;
    attempt += 1
  ) {
    try {
      const poolAccount =
        await connection.getAccountInfo(
          poolId,
          {
            commitment: "confirmed",
            minContextSlot,
          },
        );

      if (!poolAccount) {
        throw new Error(
          "LaunchLab pool account is not available yet.",
        );
      }

      const poolInfo =
        LaunchpadPool.decode(
          poolAccount.data,
        );

      const configAccount =
        await connection.getAccountInfo(
          poolInfo.configId,
          {
            commitment: "confirmed",
            minContextSlot,
          },
        );

      if (!configAccount) {
        throw new Error(
          "LaunchLab config account is not available yet.",
        );
      }

      const configInfo =
        LaunchpadConfig.decode(
          configAccount.data,
        );

      const openPriceSol =
        Curve.getPoolInitPriceByPool({
          poolInfo,
          curveType:
            configInfo.curveType,
          decimalA:
            poolInfo.mintDecimalsA,
          decimalB:
            poolInfo.mintDecimalsB,
        }).toNumber();

      const closePriceSol =
        Curve.getPrice({
          poolInfo,
          curveType:
            configInfo.curveType,
          decimalA:
            poolInfo.mintDecimalsA,
          decimalB:
            poolInfo.mintDecimalsB,
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
        await sleep(
          700 + attempt * 350,
        );
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
  const launchpadProgramId =
    getLaunchpadProgramId();

  const cpmmProgramId =
    KODIAK_IS_DEVNET
      ? DEVNET_PROGRAM_ID
          .CREATE_CPMM_POOL_PROGRAM
      : CREATE_CPMM_POOL_PROGRAM;

  const parsed =
    await connection.getParsedTransaction(
      signature,
      {
        commitment:
          "confirmed",
        maxSupportedTransactionVersion:
          0,
      },
    );

  if (!parsed) {
    return {
      tokenAmount:
        0,
      timestamp:
        Math.floor(
          Date.now() /
            1000,
        ),
    };
  }

  if (parsed.meta?.err) {
    return {
      tokenAmount:
        0,
      timestamp:
        parsed.blockTime ??
        Math.floor(
          Date.now() /
            1000,
        ),
      slot:
        parsed.slot,
    };
  }

  const ownerKey =
    new PublicKey(
      wallet,
    );

  const owner =
    ownerKey.toBase58();

  /*
   * The API caller does not get to nominate an arbitrary wallet after the
   * fact. The submitted wallet must actually be a signer of the confirmed
   * transaction.
   */
  if (
    !walletSignedTransaction(
      parsed,
      ownerKey,
    )
  ) {
    throw new Error(
      "The submitted wallet did not sign this transaction.",
    );
  }

  const isLaunchpad =
    transactionHasProgram(
      parsed,
      launchpadProgramId,
    );

  const isCpmm =
    transactionHasProgram(
      parsed,
      cpmmProgramId,
    );

  if (
    !isLaunchpad &&
    !isCpmm
  ) {
    throw new Error(
      "The transaction does not invoke Kodiak's active Raydium LaunchLab or CPMM program.",
    );
  }

  const pre =
    collectBalances(
      parsed.meta
        ?.preTokenBalances,
    );

  const post =
    collectBalances(
      parsed.meta
        ?.postTokenBalances,
    );

  const ownerDelta =
    findOwnerTokenDelta(
      pre,
      post,
      mint,
      owner,
    );

  const ownerDirectionMatches =
    ownerDelta
      ? side === "buy"
        ? ownerDelta.delta > 0
        : ownerDelta.delta < 0
      : false;

  /*
   * Prefer the wallet's own token delta. A pool-vault fallback is retained
   * for transactions where parsed owner metadata has not propagated yet.
   */
  const poolDelta =
    findPoolTokenDelta(
      pre,
      post,
      mint,
      side,
    );

  const tokenAmount =
    Math.abs(
      ownerDirectionMatches
        ? ownerDelta?.delta ??
            0
        : poolDelta?.delta ??
            0,
    );

  if (
    !Number.isFinite(
      tokenAmount,
    ) ||
    tokenAmount <= 0
  ) {
    return {
      tokenAmount:
        0,
      timestamp:
        parsed.blockTime ??
        Math.floor(
          Date.now() /
            1000,
        ),
      slot:
        parsed.slot,
    };
  }

  if (isCpmm) {
    /*
     * CPMM is a constant-product pool with real token reserves, so the
     * transaction's pre/post pool-vault balances are the authoritative spot
     * prices for this candle. This is intentionally different from LaunchLab,
     * whose virtual reserves must be decoded from LaunchpadPool state.
     */
    const cpmm =
      cpmmPricesFromTransaction({
        pre,
        post,
        mint,
        owner,
        side,
      });

    return {
      tokenAmount,
      quoteAmountSol:
        cpmm.quoteAmountSol,
      timestamp:
        parsed.blockTime ??
        Math.floor(
          Date.now() /
            1000,
        ),
      openPriceSol:
        cpmm.openPriceSol,
      closePriceSol:
        cpmm.closePriceSol,
      slot:
        parsed.slot,
      marketType:
        "cpmm",
    };
  }

  /*
   * LaunchLab uses virtual reserves. Never derive its OHLC from ordinary SPL
   * vault ratios; read the decoded on-chain curve after the confirmed trade.
   */
  const curvePrices =
    await readLaunchpadCurvePrices(
      mint,
      parsed.slot,
    );

  /*
   * Use the quote-side reserve delta as server-verified volume. This prevents
   * clients from inflating chart volume / analytics by posting an arbitrary
   * solAmount alongside a real tiny trade signature.
   */
  const quoteReserve =
    findReserveDelta(
      pre,
      post,
      NATIVE_MINT.toBase58(),
      side === "buy"
        ? "increase"
        : "decrease",
      owner,
    );

  const quoteAmountSol =
    Math.abs(
      quoteReserve?.delta ??
        0,
    );

  return {
    tokenAmount,
    quoteAmountSol:
      Number.isFinite(
        quoteAmountSol,
      ) &&
      quoteAmountSol > 0
        ? quoteAmountSol
        : undefined,
    timestamp:
      parsed.blockTime ??
      Math.floor(
        Date.now() /
          1000,
      ),
    openPriceSol:
      curvePrices.openPriceSol,
    closePriceSol:
      curvePrices.closePriceSol,
    slot:
      parsed.slot,
    marketType:
      "launchpad",
  };
}

export async function saveTrade(
  trade: StoredTrade,
) {
  const added = await redis<number>([
    "SADD",
    signatureKey(trade.mint),
    trade.signature,
  ]);

  if (added === 0) {
    const existing =
      await getTrades(
        trade.mint,
      );

    return (
      existing.find(
        (row) =>
          row.signature ===
          trade.signature,
      ) ?? trade
    );
  }

  const key = tradeKey(
    trade.mint,
  );

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
  const rows =
    await redis<string[]>([
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
        return JSON.parse(
          row,
        ) as StoredTrade;
      } catch {
        return null;
      }
    })
    .filter(
      (
        row,
      ): row is StoredTrade =>
        Boolean(row),
    )
    .sort(
      (a, b) =>
        a.timestamp -
        b.timestamp,
    );
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
    const storedOpen = Number(trade.openPriceSol);
    const storedClose = Number(trade.closePriceSol);

    /*
     * Prefer reconstructed/verified marginal spot prices. LaunchLab trades are
     * rebuilt from the bonding-curve realA/realB state in market-sync.ts;
     * CPMM trades carry transaction-local reserve prices. Execution price is
     * only a last-resort legacy fallback, never the preferred candle close.
     */
    const eventClose =
      Number.isFinite(storedClose) && storedClose > 0
        ? storedClose
        : executionPrice;

    if (!Number.isFinite(eventClose) || eventClose <= 0) {
      continue;
    }

    const eventOpen =
      Number.isFinite(storedOpen) && storedOpen > 0
        ? storedOpen
        : Number.isFinite(previousClose) && previousClose > 0
          ? previousClose
          : eventClose;

    const time =
      Math.floor(trade.timestamp / intervalSeconds) * intervalSeconds;

    const eventHigh = Math.max(eventOpen, eventClose);
    const eventLow = Math.min(eventOpen, eventClose);
    const current = buckets.get(time);

    if (!current) {
      buckets.set(time, {
        time,
        open: eventOpen,
        high: eventHigh,
        low: eventLow,
        close: eventClose,
        volume: Math.abs(Number(trade.solAmount || 0)),
      });
    } else {
      current.high = Math.max(current.high, eventHigh);
      current.low = Math.min(current.low, eventLow);
      current.close = eventClose;
      current.volume += Math.abs(Number(trade.solAmount || 0));
    }

    previousClose = eventClose;
  }

  return [...buckets.values()].sort((a, b) => a.time - b.time);
}
