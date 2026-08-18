import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  getPdaLaunchpadPoolId,
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
  KODIAK_IS_MAINNET,
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
      KODIAK_LAUNCHPAD_PROGRAM_ID,
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
    new PublicKey(
      mint,
    );

  const poolId =
    getPdaLaunchpadPoolId(
      KODIAK_LAUNCHPAD_PROGRAM_ID,
      mintKey,
      NATIVE_MINT,
    ).publicKey;

  const existing =
    await getTrades(
      mint,
    );

  const known =
    new Set(
      existing.map(
        (trade) =>
          trade.signature,
      ),
    );

  const signatures =
    await connection
      .getSignaturesForAddress(
        poolId,
        {
          limit:
            100,
        },
        "confirmed",
      );

  const missing =
    signatures
      .filter(
        (entry) =>
          entry.err === null &&
          !known.has(
            entry.signature,
          ),
      )
      .sort(
        (a, b) =>
          (a.blockTime ?? 0) -
          (b.blockTime ?? 0),
      );

  const saved:
    StoredTrade[] =
      [];

  let workingTrades =
    [...existing];

  for (
    const entry of
    missing
  ) {
    try {
      const identity =
        await identifyTrade(
          entry.signature,
          mint,
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
        Number(
          inferred.quoteAmountSol,
        );

      const tokenAmount =
        Number(
          inferred.tokenAmount,
        );

      if (
        !Number.isFinite(
          solAmount,
        ) ||
        solAmount <= 0 ||
        !Number.isFinite(
          tokenAmount,
        ) ||
        tokenAmount <= 0
      ) {
        continue;
      }

      const executionPrice =
        solAmount /
        tokenAmount;

      const previousClose =
        validPrice(
          workingTrades.at(
            -1,
          )?.closePriceSol,
        );

      const inferredOpen =
        validPrice(
          inferred.openPriceSol,
        );

      const inferredClose =
        validPrice(
          inferred.closePriceSol,
        );

      const openPriceSol =
        previousClose ??
        inferredOpen;

      const directionMatches =
        openPriceSol &&
        inferredClose
          ? identity.side ===
            "buy"
            ? inferredClose >
              openPriceSol
            : inferredClose <
              openPriceSol
          : false;

      const trade:
        StoredTrade = {
          mint,
          wallet:
            identity.wallet,
          signature:
            entry.signature,
          side:
            identity.side,
          solAmount,
          tokenAmount,
          priceSol:
            executionPrice,
          timestamp:
            inferred.timestamp ||
            entry.blockTime ||
            Math.floor(
              Date.now() /
                1000,
            ),
          ...(directionMatches
            ? {
                openPriceSol,
                closePriceSol:
                  inferredClose,
              }
            : {}),
        };

      const stored =
        await saveTrade(
          trade,
        );

      workingTrades =
        [...workingTrades, stored]
          .sort(
            (a, b) =>
              a.timestamp -
              b.timestamp,
          );

      try {
        await recordCreatorReward(
          stored,
        );
      } catch (
        rewardError
      ) {
        console.error(
          "External trade creator reward ledger write failed:",
          rewardError,
        );
      }

      saved.push(
        stored,
      );
    } catch (
      error
    ) {
      /*
       * A pool address also appears in non-trade transactions such as launch
       * creation and migration. Skip anything that cannot be proven to be a
       * real wallet token delta.
       */
      console.info(
        "Kodiak skipped a non-trade or not-yet-readable pool transaction:",
        entry.signature,
        error instanceof
          Error
          ? error.message
          : error,
      );
    }
  }

  return {
    poolId:
      poolId.toBase58(),
    discovered:
      saved.length,
    trades:
      workingTrades,
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
