import { NextRequest, NextResponse } from "next/server";
import {
  getTrades,
  inferTokenAmount,
  saveTrade,
  type StoredTrade,
} from "@/lib/devnet-market";
import { recordCreatorReward } from "@/lib/creator-rewards";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ mint: string }>;
};

type TradeRequest = {
  wallet?: string;
  signature?: string;
  signatures?: string[];
  side?: "buy" | "sell";
  solAmount?: number;
};

export async function GET(
  _request: NextRequest,
  context: Context,
) {
  try {
    const { mint } = await context.params;
    const trades = await getTrades(mint);

    return NextResponse.json({
      mint,
      trades: [...trades]
        .reverse()
        .slice(0, 100),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load trades.",
      },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  context: Context,
) {
  try {
    const { mint } = await context.params;
    const body =
      (await request.json()) as TradeRequest;

    const wallet = body.wallet?.trim() ?? "";
    const side = body.side ?? "buy";
    const solAmount = Number(body.solAmount);

    const candidateSignatures = Array.from(
      new Set(
        [
          ...(Array.isArray(body.signatures)
            ? body.signatures
            : []),
          body.signature,
        ]
          .filter(
            (value): value is string =>
              typeof value === "string" &&
              value.trim().length >= 64,
          )
          .map((value) => value.trim()),
      ),
    );

    if (
      !wallet ||
      candidateSignatures.length === 0 ||
      !Number.isFinite(solAmount) ||
      solAmount <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "wallet, at least one transaction signature, and a positive solAmount are required.",
        },
        { status: 400 },
      );
    }

    const existingTrades = await getTrades(mint);

    const existing = existingTrades.find(
      (trade) =>
        candidateSignatures.includes(
          trade.signature,
        ),
    );

    if (existing) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        trade: existing,
      });
    }

    let selectedSignature = "";
    let inferred:
      | Awaited<
          ReturnType<typeof inferTokenAmount>
        >
      | undefined;

    for (const signature of candidateSignatures) {
      try {
        const next = await inferTokenAmount(
          signature,
          mint,
          wallet,
        );

        if (
          Number.isFinite(next.tokenAmount) &&
          next.tokenAmount > 0
        ) {
          selectedSignature = signature;
          inferred = next;
          break;
        }
      } catch {
        // Try the next confirmed transaction.
      }
    }

    if (!selectedSignature || !inferred) {
      return NextResponse.json(
        {
          error:
            "The launch was confirmed, but none of its transactions exposed the creator token balance change yet. Retry shortly.",
          retryable: true,
        },
        { status: 409 },
      );
    }

    const executionPrice =
      solAmount / inferred.tokenAmount;

    if (
      !Number.isFinite(executionPrice) ||
      executionPrice <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "The trade price could not be calculated from the confirmed transaction.",
        },
        { status: 422 },
      );
    }

    const previousClose =
      existingTrades.at(-1)?.closePriceSol ??
      existingTrades.at(-1)?.priceSol;

    const rawOpen =
      inferred.openPriceSol ??
      previousClose ??
      executionPrice;

    const rawClose =
      inferred.closePriceSol ??
      executionPrice;

    const openPriceSol =
      side === "buy"
        ? Math.min(rawOpen, rawClose)
        : Math.max(rawOpen, rawClose);

    const closePriceSol =
      side === "buy"
        ? Math.max(rawOpen, rawClose)
        : Math.min(rawOpen, rawClose);

    const trade: StoredTrade = {
      mint,
      wallet,
      signature: selectedSignature,
      side,
      solAmount,
      tokenAmount: inferred.tokenAmount,
      priceSol: executionPrice,
      openPriceSol,
      closePriceSol,
      timestamp: inferred.timestamp,
    };

    const saved = await saveTrade(trade);

    try {
      await recordCreatorReward(saved);
    } catch (rewardError) {
      console.error(
        "Creator reward ledger write failed:",
        rewardError,
      );
    }

    return NextResponse.json({
      ok: true,
      duplicate: false,
      trade: saved,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to record trade.",
      },
      { status: 500 },
    );
  }
}
