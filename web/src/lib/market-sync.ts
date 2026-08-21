import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  CREATE_CPMM_POOL_PROGRAM,
  DEVNET_PROGRAM_ID,
  getCpmmPdaPoolId,
  getPdaLaunchpadPoolId,
  LaunchpadPool,
  PlatformConfig,
} from "@raydium-io/raydium-sdk-v2";

import {
  KODIAK_LAUNCHPAD_PROGRAM_ID,
} from "@/lib/raydium/devnet";
import {
  getTrades,
  inferTokenAmount,
  saveTrade,
  type StoredTrade,
} from "@/lib/devnet-market";
import {
  recordCreatorReward,
} from "@/lib/creator-rewards";
import {
  KODIAK_IS_DEVNET,
  KODIAK_IS_MAINNET,
  KODIAK_MAINNET_CPMM_CONFIG_ID,
  KODIAK_RPC_URL,
} from "@/lib/solana/network";

type ParsedTransaction =
  NonNullable<
    Awaited<
      ReturnType<
        Connection["getParsedTransaction"]
      >
    >
  >;

type ParsedTokenBalance = {
  owner?: string;
  mint: string;
  uiTokenAmount: {
    uiAmountString?: string | null;
    amount: string;
    decimals: number;
  };
};

function serverRpcUrl() {
  if (KODIAK_IS_MAINNET) {
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

const connection =
  new Connection(
    serverRpcUrl(),
    "confirmed",
  );

function uiAmount(
  balance:
    ParsedTokenBalance,
) {
  const ui =
    balance.uiTokenAmount
      .uiAmountString;

  if (ui != null) {
    const parsed =
      Number(
        ui,
      );

    return Number.isFinite(
      parsed,
    )
      ? parsed
      : 0;
  }

  const raw =
    Number(
      balance.uiTokenAmount
        .amount,
    );

  const decimals =
    Number(
      balance.uiTokenAmount
        .decimals,
    );

  if (
    !Number.isFinite(raw) ||
    !Number.isFinite(decimals)
  ) {
    return 0;
  }

  return (
    raw /
    10 ** decimals
  );
}

function ownerMintAmount(
  rows:
    | ParsedTokenBalance[]
    | null
    | undefined,
  owner: string,
  mint: string,
) {
  return (
    rows ?? []
  )
    .filter(
      (row) =>
        row.owner === owner &&
        row.mint === mint,
    )
    .reduce(
      (
        total,
        row,
      ) =>
        total +
        uiAmount(
          row,
        ),
      0,
    );
}

function transactionUsesProgram(
  transaction:
    ParsedTransaction,
  programId:
    PublicKey,
) {
  return (
    transaction.transaction
      .message.accountKeys
      .some(
        (account) =>
          account.pubkey.equals(
            programId,
          ),
      )
  );
}

async function identifyTrade(
  signature: string,
  mint: string,
  allowedProgramId: PublicKey,
) {
  const parsed =
    await connection
      .getParsedTransaction(
        signature,
        {
          commitment:
            "confirmed",
          maxSupportedTransactionVersion:
            0,
        },
      );

  if (
    !parsed ||
    parsed.meta?.err ||
    !transactionUsesProgram(
      parsed,
      allowedProgramId,
    )
  ) {
    return null;
  }

  const pre =
    (parsed.meta
      ?.preTokenBalances ??
      []) as ParsedTokenBalance[];

  const post =
    (parsed.meta
      ?.postTokenBalances ??
      []) as ParsedTokenBalance[];

  const signerAddresses =
    parsed.transaction
      .message.accountKeys
      .filter(
        (account) =>
          account.signer,
      )
      .map(
        (account) =>
          account.pubkey
            .toBase58(),
      );

  let best:
    | {
        wallet:
          string;
        side:
          "buy" | "sell";
        tokenDelta:
          number;
      }
    | null =
      null;

  for (
    const wallet of
    signerAddresses
  ) {
    const before =
      ownerMintAmount(
        pre,
        wallet,
        mint,
      );

    const after =
      ownerMintAmount(
        post,
        wallet,
        mint,
      );

    const delta =
      after -
      before;

    if (
      !Number.isFinite(
        delta,
      ) ||
      delta === 0
    ) {
      continue;
    }

    const candidate = {
      wallet,
      side:
        delta > 0
          ? "buy" as const
          : "sell" as const,
      tokenDelta:
        Math.abs(
          delta,
        ),
    };

    if (
      !best ||
      candidate.tokenDelta >
        best.tokenDelta
    ) {
      best =
        candidate;
    }
  }

  return best;
}

function validPrice(
  value:
    unknown,
) {
  const parsed =
    Number(
      value,
    );

  return (
    Number.isFinite(
      parsed,
    ) &&
    parsed >
      0
  )
    ? parsed
    : undefined;
}

function cpmmProgramId() {
  return KODIAK_IS_DEVNET
    ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM
    : CREATE_CPMM_POOL_PROGRAM;
}

async function findCpmmPoolForLaunchpad(
  launchpadPoolId: PublicKey,
) {
  const account =
    await connection.getAccountInfo(
      launchpadPoolId,
      "confirmed",
    );

  if (!account) {
    return null;
  }

  const poolInfo =
    LaunchpadPool.decode(
      account.data,
    );

  if (Number(poolInfo.status) !== 1) {
    return null;
  }

  const platformAccount =
    await connection.getAccountInfo(
      poolInfo.platformId,
      "confirmed",
    );

  if (!platformAccount) {
    return null;
  }

  const platformInfo =
    PlatformConfig.decode(
      platformAccount.data,
    );

  const cpConfigId =
    platformInfo.cpConfigId;

  if (
    KODIAK_IS_MAINNET &&
    cpConfigId.toBase58() !==
      KODIAK_MAINNET_CPMM_CONFIG_ID
  ) {
    throw new Error(
      "Kodiak Mainnet PlatformConfig CPMM target no longer matches the verified configuration.",
    );
  }

  const programId =
    cpmmProgramId();

  const candidates = [
    getCpmmPdaPoolId(
      programId,
      cpConfigId,
      poolInfo.mintA,
      poolInfo.mintB,
    ).publicKey,
    getCpmmPdaPoolId(
      programId,
      cpConfigId,
      poolInfo.mintB,
      poolInfo.mintA,
    ).publicKey,
  ];

  for (const candidate of candidates) {
    const candidateAccount =
      await connection.getAccountInfo(
        candidate,
        "confirmed",
      );

    if (
      candidateAccount &&
      candidateAccount.owner.equals(
        programId,
      )
    ) {
      return candidate;
    }
  }

  return null;
}

/*
 * Reconcile trades that happened directly through Phantom, Jupiter, Raydium,
 * or another interface.
 *
 * Kodiak watches the verified LaunchLab pool account itself instead of relying
 * on a browser POST after a Kodiak trade. The existing POST route remains as a
 * fast path; this reconciler is the source-of-truth safety net.
 *
 * IMPORTANT:
 * We never invent an OHLC move. If the confirmed post-trade curve price cannot
 * be reconciled against Kodiak's previous verified close, the trade is still
 * stored for volume/activity/accounting, but without OHLC fields so
 * buildCandles() will refuse to draw a fake candle.
 */
export async function syncRecentLaunchpadTrades(
  mint: string,
) {
  const mintKey =
    new PublicKey(mint);

  const launchpadPoolId =
    getPdaLaunchpadPoolId(
      KODIAK_LAUNCHPAD_PROGRAM_ID,
      mintKey,
      NATIVE_MINT,
    ).publicKey;

  const cpmmPoolId =
    await findCpmmPoolForLaunchpad(
      launchpadPoolId,
    );

  const existing =
    await getTrades(mint);

  const known =
    new Set(
      existing.map(
        (trade) => trade.signature,
      ),
    );

  const watchedPools = [
    {
      poolId: launchpadPoolId,
      programId: KODIAK_LAUNCHPAD_PROGRAM_ID,
    },
    ...(cpmmPoolId
      ? [{
          poolId: cpmmPoolId,
          programId: cpmmProgramId(),
        }]
      : []),
  ];

  const signatureRows =
    await Promise.all(
      watchedPools.map(
        async (market) => ({
          ...market,
          signatures:
            await connection.getSignaturesForAddress(
              market.poolId,
              { limit: 100 },
              "confirmed",
            ),
        }),
      ),
    );

  const missing =
    signatureRows
      .flatMap((market) =>
        market.signatures.map((entry) => ({
          ...entry,
          programId: market.programId,
        })),
      )
      .filter(
        (entry) =>
          entry.err === null &&
          !known.has(entry.signature),
      )
      .sort(
        (a, b) =>
          (a.blockTime ?? 0) -
          (b.blockTime ?? 0),
      );

  const saved: StoredTrade[] = [];
  let workingTrades = [...existing];

  for (const entry of missing) {
    try {
      const identity =
        await identifyTrade(
          entry.signature,
          mint,
          entry.programId,
        );

      if (!identity) {
        continue;
      }

      const inferred =
        await inferTokenAmount(
          entry.signature,
          mint,
          identity.wallet,
          identity.side,
        );

      const solAmount =
        Number(inferred.quoteAmountSol);
      const tokenAmount =
        Number(inferred.tokenAmount);

      if (
        !Number.isFinite(solAmount) ||
        solAmount <= 0 ||
        !Number.isFinite(tokenAmount) ||
        tokenAmount <= 0
      ) {
        continue;
      }

      const executionPrice =
        solAmount / tokenAmount;

      const previousTrade =
        workingTrades.at(-1);
      const previousClose =
        validPrice(
          previousTrade?.marketType === "cpmm"
            ? previousTrade.closePriceSol
            : previousTrade?.priceSol,
        );
      const inferredOpen =
        validPrice(inferred.openPriceSol);
      const inferredClose =
        validPrice(inferred.closePriceSol);

      /*
       * A normal Solana RPC cannot return historical LaunchpadPool account
       * bytes for an arbitrary transaction slot. For LaunchLab, use the
       * verified transaction execution price as the historical chart print.
       * CPMM still has exact pre/post reserve ratios inside the transaction.
       */
      const openPriceSol =
        inferred.marketType === "cpmm"
          ? inferredOpen
          : previousClose ?? inferredOpen ?? executionPrice;

      const closePriceSol =
        inferred.marketType === "cpmm"
          ? inferredClose
          : executionPrice;

      const hasVerifiedCandle =
        openPriceSol &&
        closePriceSol &&
        (inferred.marketType !== "cpmm" ||
          (identity.side === "buy"
            ? closePriceSol > openPriceSol
            : closePriceSol < openPriceSol));

      const trade: StoredTrade = {
        mint,
        wallet: identity.wallet,
        signature: entry.signature,
        side: identity.side,
        solAmount,
        tokenAmount,
        priceSol: executionPrice,
        timestamp:
          inferred.timestamp ||
          entry.blockTime ||
          Math.floor(Date.now() / 1000),
        marketType: inferred.marketType,
        ...(hasVerifiedCandle
          ? {
              openPriceSol,
              closePriceSol,
            }
          : {}),
      };

      const stored =
        await saveTrade(trade);

      workingTrades =
        [...workingTrades, stored]
          .sort(
            (a, b) =>
              a.timestamp - b.timestamp,
          );

      try {
        await recordCreatorReward(stored);
      } catch (rewardError) {
        console.error(
          "External trade creator reward ledger write failed:",
          rewardError,
        );
      }

      saved.push(stored);
      known.add(entry.signature);
    } catch (error) {
      console.info(
        "Kodiak skipped a non-trade or not-yet-readable market transaction:",
        entry.signature,
        error instanceof Error
          ? error.message
          : error,
      );
    }
  }

  return {
    poolId: launchpadPoolId.toBase58(),
    launchpadPoolId:
      launchpadPoolId.toBase58(),
    cpmmPoolId:
      cpmmPoolId?.toBase58() ?? null,
    discovered: saved.length,
    trades: workingTrades,
  };
}

export async function getSyncedTrades(
  mint: string,
) {
  try {
    const result =
      await syncRecentLaunchpadTrades(
        mint,
      );

    return (
      result.trades
    );
  } catch (
    error
  ) {
    /*
     * Market pages must remain usable during an RPC hiccup. Existing indexed
     * history is the fallback, never an empty fabricated result.
     */
    console.error(
      "Kodiak external trade reconciliation failed:",
      error,
    );

    return getTrades(
      mint,
    );
  }
}
