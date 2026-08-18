import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

import {
  getTrades,
  inferTokenAmount,
  saveTrade,
  type StoredTrade,
} from "@/lib/devnet-market";
import { recordCreatorReward } from "@/lib/creator-rewards";
import {
  KODIAK_NETWORK,
} from "@/lib/solana/network";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    mint: string;
  }>;
};

type TradeRequest = {
  wallet?: string;
  signature?: string;
  signatures?: string[];
  side?: "buy" | "sell";

  /*
   * Kept for compatibility with existing clients, but it is NOT trusted.
   * Kodiak derives recorded SOL volume from the confirmed transaction.
   */
  solAmount?: number;
  tokenAmount?: number;
};

function canonicalPublicKey(
  value: string,
  label: string,
) {
  const key =
    new PublicKey(
      value,
    );

  if (
    key.toBase58() !==
    value
  ) {
    throw new Error(
      `${label} is not a canonical Solana public key.`,
    );
  }

  return key;
}

export async function GET(
  _request: NextRequest,
  context: Context,
) {
  try {
    const {
      mint: rawMint,
    } =
      await context.params;

    const mint =
      canonicalPublicKey(
        rawMint,
        "Token mint",
      ).toBase58();

    const trades =
      await getTrades(
        mint,
      );

    return NextResponse.json(
      {
        network:
          KODIAK_NETWORK,
        mint,
        trades:
          [...trades]
            .reverse()
            .slice(
              0,
              100,
            ),
      },
      {
        headers: {
          "Cache-Control":
            "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load trades.",
        network:
          KODIAK_NETWORK,
      },
      {
        status:
          400,
      },
    );
  }
}

export async function POST(
  request: NextRequest,
  context: Context,
) {
  try {
    const {
      mint: rawMint,
    } =
      await context.params;

    const mint =
      canonicalPublicKey(
        rawMint,
        "Token mint",
      ).toBase58();

    const body =
      (await request.json()) as TradeRequest;

    const walletRaw =
      body.wallet?.trim() ??
      "";

    if (!walletRaw) {
      return NextResponse.json(
        {
          error:
            "wallet is required.",
          network:
            KODIAK_NETWORK,
        },
        {
          status:
            400,
        },
      );
    }

    const wallet =
      canonicalPublicKey(
        walletRaw,
        "Wallet",
      ).toBase58();

    const side =
      body.side === "sell"
        ? "sell"
        : "buy";

    const candidateSignatures =
      Array.from(
        new Set(
          [
            ...(Array.isArray(
              body.signatures,
            )
              ? body.signatures
              : []),
            body.signature,
          ]
            .filter(
              (
                value,
              ): value is string =>
                typeof value ===
                  "string" &&
                value.trim()
                  .length >=
                  64,
            )
            .map(
              (value) =>
                value.trim(),
            ),
        ),
      );

    if (
      candidateSignatures.length ===
      0
    ) {
      return NextResponse.json(
        {
          error:
            "At least one confirmed Solana transaction signature is required.",
          network:
            KODIAK_NETWORK,
        },
        {
          status:
            400,
        },
      );
    }

    const existingTrades =
      await getTrades(
        mint,
      );

    const existing =
      existingTrades.find(
        (trade) =>
          candidateSignatures.includes(
            trade.signature,
          ),
      );

    if (existing) {
      return NextResponse.json({
        ok:
          true,
        duplicate:
          true,
        network:
          KODIAK_NETWORK,
        trade:
          existing,
      });
    }

    let selectedSignature =
      "";

    let inferred:
      | Awaited<
          ReturnType<
            typeof inferTokenAmount
          >
        >
      | undefined;

    for (
      const signature of
      candidateSignatures
    ) {
      try {
        const next =
          await inferTokenAmount(
            signature,
            mint,
            wallet,
            side,
          );

        if (
          Number.isFinite(
            next.tokenAmount,
          ) &&
          next.tokenAmount >
            0 &&
          Number.isFinite(
            next.quoteAmountSol,
          ) &&
          Number(
            next.quoteAmountSol,
          ) >
            0
        ) {
          selectedSignature =
            signature;
          inferred =
            next;
          break;
        }
      } catch {
        /*
         * Launch can return multiple transaction signatures. Try the next one
         * until Kodiak finds the signed trade transaction with verified token
         * and quote-side balance changes.
         */
      }
    }

    if (
      !selectedSignature ||
      !inferred
    ) {
      return NextResponse.json(
        {
          error:
            "Kodiak could not verify both the token amount and SOL-side volume from the confirmed transaction yet. Retry shortly.",
          retryable:
            true,
          network:
            KODIAK_NETWORK,
        },
        {
          status:
            409,
        },
      );
    }

    const verifiedSolAmount =
      Number(
        inferred.quoteAmountSol,
      );

    const executionPrice =
      verifiedSolAmount /
      inferred.tokenAmount;

    if (
      !Number.isFinite(
        executionPrice,
      ) ||
      executionPrice <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "The verified execution price could not be calculated from the confirmed transaction.",
          network:
            KODIAK_NETWORK,
        },
        {
          status:
            422,
        },
      );
    }

    const officialClose =
      Number(
        inferred.closePriceSol,
      );

    const inferredOpen =
      Number(
        inferred.openPriceSol,
      );

    if (
      !Number.isFinite(
        officialClose,
      ) ||
      officialClose <= 0
    ) {
      return NextResponse.json(
        {
          error:
            inferred.marketType ===
            "cpmm"
              ? "Raydium's confirmed CPMM post-trade spot price is not available yet. Kodiak will retry instead of estimating the candle."
              : "Raydium's confirmed post-trade bonding-curve spot price is not available yet. Kodiak will retry instead of drawing an estimated candle.",
          retryable:
            true,
          network:
            KODIAK_NETWORK,
        },
        {
          status:
            409,
        },
      );
    }

    const previousTrade =
      existingTrades.at(
        -1,
      );

    const previousClose =
      Number(
        previousTrade
          ?.closePriceSol,
      );

    /*
     * For CPMM, the confirmed transaction itself exposes the exact pre-swap
     * reserve ratio, so use it as the candle open. For LaunchLab, virtual
     * reserves are read after confirmation; previous verified close remains
     * the best pre-trade open except for the very first trade.
     */
    const openPriceSol =
      inferred.marketType ===
      "cpmm"
        ? inferredOpen
        : Number.isFinite(
              previousClose,
            ) &&
            previousClose > 0
          ? previousClose
          : inferredOpen;

    if (
      !Number.isFinite(
        openPriceSol,
      ) ||
      openPriceSol <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "Raydium's confirmed pre-trade spot price is not available yet. Kodiak will retry instead of estimating the candle open.",
          retryable:
            true,
          network:
            KODIAK_NETWORK,
        },
        {
          status:
            409,
        },
      );
    }

    const directionIsCorrect =
      side === "buy"
        ? officialClose >
          openPriceSol
        : officialClose <
          openPriceSol;

    if (!directionIsCorrect) {
      return NextResponse.json(
        {
          error:
            side === "buy"
              ? "The verification RPC has not caught up to this buy yet. Kodiak will retry rather than record a buy whose spot price does not increase."
              : "The verification RPC has not caught up to this sell yet. Kodiak will retry rather than record a sell whose spot price does not decrease.",
          retryable:
            true,
          network:
            KODIAK_NETWORK,
        },
        {
          status:
            409,
        },
      );
    }

    const trade:
      StoredTrade = {
        mint,
        wallet,
        signature:
          selectedSignature,
        side,
        /*
         * Never record the client-submitted solAmount as authoritative.
         */
        solAmount:
          verifiedSolAmount,
        tokenAmount:
          inferred.tokenAmount,
        priceSol:
          executionPrice,
        openPriceSol,
        closePriceSol:
          officialClose,
        timestamp:
          inferred.timestamp,
      };

    const saved =
      await saveTrade(
        trade,
      );

    try {
      await recordCreatorReward(
        saved,
      );
    } catch (rewardError) {
      console.error(
        "Creator reward ledger write failed:",
        rewardError,
      );
    }

    return NextResponse.json({
      ok:
        true,
      duplicate:
        false,
      network:
        KODIAK_NETWORK,
      marketType:
        inferred.marketType,
      trade:
        saved,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to record trade.",
        network:
          KODIAK_NETWORK,
      },
      {
        status:
          500,
      },
    );
  }
}
