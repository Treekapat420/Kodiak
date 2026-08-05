import { NextRequest, NextResponse } from "next/server";
import { buildCandles, getTrades } from "@/lib/devnet-market";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ mint: string }>;
};

const intervalMap: Record<string, number> = {
  "1s": 1,
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
};

export async function GET(
  request: NextRequest,
  context: Context,
) {
  try {
    const { mint } = await context.params;

    const requestedInterval =
      request.nextUrl.searchParams
        .get("interval")
        ?.toLowerCase() ?? "1m";

    const interval =
      requestedInterval in intervalMap
        ? requestedInterval
        : "1m";

    const trades = await getTrades(mint);

    const candles = buildCandles(
      trades,
      intervalMap[interval],
      500,
    );

    return NextResponse.json(
      {
        mint,
        interval,
        intervalSeconds: intervalMap[interval],
        source: "kodiak-devnet",
        candles,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to build candles.",
      },
      { status: 500 },
    );
  }
}
