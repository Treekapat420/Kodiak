import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

function asNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function asTime(value: unknown) {
  const number = asNumber(value);
  if (number === null) return null;
  return Math.floor(number > 10_000_000_000 ? number / 1000 : number);
}

function findRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const root = payload as Record<string, unknown>;
  for (const candidate of [
    root.data,
    root.rows,
    root.items,
    root.list,
    root.klines,
    root.candles,
  ]) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      for (const key of ["rows", "items", "list", "klines", "candles", "data"]) {
        if (Array.isArray(nested[key])) return nested[key] as unknown[];
      }
    }
  }
  return [];
}

function normalizeRow(row: unknown): Candle | null {
  if (Array.isArray(row)) {
    const time = asTime(row[0]);
    const open = asNumber(row[1]);
    const high = asNumber(row[2]);
    const low = asNumber(row[3]);
    const close = asNumber(row[4]);

    if (
      time === null ||
      open === null ||
      high === null ||
      low === null ||
      close === null
    ) {
      return null;
    }

    return { time, open, high, low, close };
  }

  if (!row || typeof row !== "object") return null;
  const item = row as Record<string, unknown>;
  const time = asTime(
    item.time ?? item.timestamp ?? item.openTime ?? item.open_time ?? item.t,
  );
  const open = asNumber(item.open ?? item.o);
  const high = asNumber(item.high ?? item.h);
  const low = asNumber(item.low ?? item.l);
  const close = asNumber(item.close ?? item.c);

  if (
    time === null ||
    open === null ||
    high === null ||
    low === null ||
    close === null
  ) {
    return null;
  }

  return { time, open, high, low, close };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ mint: string }> },
) {
  try {
    const { mint: rawMint } = await context.params;
    const mint = new PublicKey(rawMint).toBase58();
    const requested = request.nextUrl.searchParams.get("interval");
    const interval =
      requested === "5m" || requested === "15m" ? requested : "1m";

    const url = new URL(
      "https://launch-history-v1-devnet.raydium.io/kline",
    );
    url.searchParams.set("poolId", mint);
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", "300");

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const payload = (await response.json()) as unknown;

    if (!response.ok) {
      throw new Error(
        `Raydium chart service returned HTTP ${response.status}.`,
      );
    }

    const candles = findRows(payload)
      .map(normalizeRow)
      .filter((item): item is Candle => item !== null)
      .sort((a, b) => a.time - b.time)
      .filter(
        (item, index, all) =>
          index === 0 || item.time !== all[index - 1].time,
      );

    return NextResponse.json({ mint, interval, candles });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load chart data.",
      },
      { status: 502 },
    );
  }
}
