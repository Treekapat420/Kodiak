import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const COINGECKO_RANGE =
  "https://api.coingecko.com/api/v3/coins/solana/market_chart/range";

export async function GET(request: NextRequest) {
  const from = Number(request.nextUrl.searchParams.get("from"));
  const to = Number(request.nextUrl.searchParams.get("to"));

  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= from) {
    return NextResponse.json({ error: "Invalid SOL/USD time range." }, { status: 400 });
  }

  try {
    const url = new URL(COINGECKO_RANGE);
    url.searchParams.set("vs_currency", "usd");
    url.searchParams.set("from", String(Math.floor(from)));
    url.searchParams.set("to", String(Math.ceil(to)));

    const response = await fetch(url, {
      headers: { accept: "application/json" },
      next: { revalidate: 60 },
    });

    if (!response.ok) {
      throw new Error(`CoinGecko returned ${response.status}`);
    }

    const payload = (await response.json()) as { prices?: [number, number][] };
    const prices = (payload.prices ?? [])
      .map(([milliseconds, price]) => ({
        time: Math.floor(milliseconds / 1000),
        price: Number(price),
      }))
      .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.price) && point.price > 0);

    if (prices.length === 0) {
      throw new Error("No SOL/USD prices returned.");
    }

    return NextResponse.json(
      { prices },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch (error) {
    console.error("SOL/USD history error", error);
    return NextResponse.json({ error: "Unable to load SOL/USD history." }, { status: 502 });
  }
}
