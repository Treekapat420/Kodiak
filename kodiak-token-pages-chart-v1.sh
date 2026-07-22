#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/Kodiak"
WEB="$ROOT/web"

echo "🐻 Installing Kodiak public token pages and charts..."

if [ ! -f "$WEB/package.json" ]; then
  echo "Error: Kodiak web/package.json was not found."
  exit 1
fi

cd "$WEB"
npm install lightweight-charts@4.2.3

mkdir -p "src/app/token/[mint]" "src/app/api/token/[mint]/chart" "src/app/api/token/[mint]" "src/components/charts"

cat > "src/app/api/token/[mint]/route.ts" <<'EOF'
import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getRedis } from "@/lib/server/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LaunchRecord = {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  signature: string;
  network: "devnet";
  createdAt: string;
  verifiedAt: string;
};

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ mint: string }> },
) {
  try {
    const { mint: rawMint } = await context.params;
    const mint = new PublicKey(rawMint).toBase58();
    const launch = await getRedis().get<LaunchRecord>(
      `kodiak:launch:${mint}`,
    );

    if (!launch) {
      return NextResponse.json(
        { error: "This token is not registered with Kodiak." },
        { status: 404 },
      );
    }

    return NextResponse.json({ launch });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load the token.",
      },
      { status: 400 },
    );
  }
}
EOF

cat > "src/app/api/token/[mint]/chart/route.ts" <<'EOF'
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
EOF

cat > "src/components/charts/LaunchChart.tsx" <<'EOF'
"use client";

import { useEffect, useRef, useState } from "react";
import {
  ColorType,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";

type Interval = "1m" | "5m" | "15m";
type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export function LaunchChart({ mint }: { mint: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [interval, setInterval] = useState<Interval>("1m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [message, setMessage] = useState("Loading chart…");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(
          `/api/token/${encodeURIComponent(mint)}/chart?interval=${interval}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as {
          candles?: Candle[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load chart.");
        }

        if (!cancelled) {
          const data = payload.candles ?? [];
          setCandles(data);
          setMessage(
            data.length
              ? `${data.length} candles loaded.`
              : "No trades yet. The first bonding-curve trade will begin the chart.",
          );
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error ? error.message : "Unable to load chart.",
          );
        }
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [interval, mint]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    chartRef.current?.remove();

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 390,
      layout: {
        background: { type: ColorType.Solid, color: "#070707" },
        textColor: "#a1a1aa",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.05)" },
        horzLines: { color: "rgba(255,255,255,0.05)" },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "rgba(255,255,255,0.10)",
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.10)",
      },
    });

    const series = chart.addCandlestickSeries({
      upColor: "#6ee7b7",
      downColor: "#fb7185",
      borderUpColor: "#6ee7b7",
      borderDownColor: "#fb7185",
      wickUpColor: "#6ee7b7",
      wickDownColor: "#fb7185",
      priceFormat: {
        type: "price",
        precision: 10,
        minMove: 0.0000000001,
      },
    });

    series.setData(
      candles.map((candle) => ({
        ...candle,
        time: candle.time as UTCTimestamp,
      })),
    );

    if (candles.length) chart.timeScale().fitContent();

    const observer = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });
    observer.observe(container);
    chartRef.current = chart;

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [candles]);

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black">Price chart</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Raydium LaunchLab Devnet OHLC · updates every 15 seconds
          </p>
        </div>
        <div className="flex gap-2">
          {(["1m", "5m", "15m"] as Interval[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setInterval(value)}
              className={`rounded-xl px-4 py-2 text-sm font-black ${
                interval === value
                  ? "bg-emerald-400 text-black"
                  : "border border-white/10 text-zinc-300"
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={containerRef}
        className="mt-5 min-h-[390px] w-full overflow-hidden rounded-2xl border border-white/10"
      />
      <p className="mt-3 text-xs text-zinc-500">{message}</p>
    </section>
  );
}
EOF

cat > "src/app/token/[mint]/page.tsx" <<'EOF'
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { KodiakWalletButton } from "@/components/wallet/KodiakWalletButton";
import { LaunchChart } from "@/components/charts/LaunchChart";

type LaunchRecord = {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  signature: string;
  network: "devnet";
  createdAt: string;
};

const short = (value: string) =>
  `${value.slice(0, 6)}…${value.slice(-6)}`;

export default function TokenPage() {
  const { mint } = useParams<{ mint: string }>();
  const [launch, setLaunch] = useState<LaunchRecord | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    void fetch(`/api/token/${encodeURIComponent(mint)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          launch?: LaunchRecord;
          error?: string;
        };
        if (!response.ok || !payload.launch) {
          throw new Error(payload.error || "Unable to load token.");
        }
        if (!cancelled) setLaunch(payload.launch);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : "Unable to load token.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mint]);

  if (error) {
    return (
      <main className="min-h-screen bg-black p-6 text-white">
        <div className="mx-auto max-w-3xl rounded-3xl border border-red-400/20 bg-red-400/[0.06] p-6">
          <h1 className="text-2xl font-black">Token unavailable</h1>
          <p className="mt-3 text-red-100">{error}</p>
        </div>
      </main>
    );
  }

  if (!launch) {
    return (
      <main className="min-h-screen bg-black p-6 text-zinc-400">
        Loading Kodiak token…
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-3xl border border-emerald-400/20 bg-white/[0.03] p-6">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.24em] text-emerald-300">
                Kodiak LaunchLab · Devnet
              </p>
              <h1 className="mt-3 text-4xl font-black sm:text-5xl">
                {launch.name}
              </h1>
              <p className="mt-2 text-2xl font-black text-amber-300">
                ${launch.symbol}
              </p>
            </div>
            <KodiakWalletButton />
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <p className="text-xs uppercase tracking-wider text-zinc-500">
                Mint
              </p>
              <p className="mt-2 font-mono text-sm font-bold">
                {short(launch.mint)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <p className="text-xs uppercase tracking-wider text-zinc-500">
                Creator
              </p>
              <p className="mt-2 font-mono text-sm font-bold">
                {short(launch.creator)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <p className="text-xs uppercase tracking-wider text-zinc-500">
                Launched
              </p>
              <p className="mt-2 text-sm font-bold">
                {new Date(launch.createdAt).toLocaleString()}
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(launch.mint)}
              className="rounded-xl border border-white/10 px-4 py-3 text-sm font-black"
            >
              Copy mint
            </button>
            <a
              href={`https://explorer.solana.com/address/${launch.mint}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-white/10 px-4 py-3 text-sm font-black text-amber-300"
            >
              Solana Explorer
            </a>
            <a
              href={`/trade?mint=${encodeURIComponent(launch.mint)}`}
              className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-black"
            >
              Trade on Devnet
            </a>
          </div>
        </header>

        <LaunchChart mint={launch.mint} />

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-2xl font-black">Live metrics</h2>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            Market cap, bonding progress, SOL raised, holders, volume,
            and creator earnings will be added in the next verified-data pass.
          </p>
        </section>
      </div>
    </main>
  );
}
EOF

python - <<'PY'
from pathlib import Path

path = Path("src/app/creator/page.tsx")
text = path.read_text()

old = '''                      <a
                        href={`https://explorer.solana.com/address/${launch.mint}?cluster=devnet`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-amber-300"
                      >
                        View token
                      </a>'''

new = '''                      <a
                        href={`/token/${launch.mint}`}
                        className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-amber-300"
                      >
                        View token + chart
                      </a>'''

if old not in text:
    raise SystemExit("Creator Dashboard token link was not found.")

path.write_text(text.replace(old, new, 1))
PY

npm run lint
npm run build

cd "$ROOT"
git add web/package.json web/package-lock.json web/src/app/token web/src/app/api/token web/src/components/charts/LaunchChart.tsx web/src/app/creator/page.tsx
git commit -m "add token pages and LaunchLab charts" || true
git push origin main

echo ""
echo "✅ Token pages and charts installed and pushed."
echo "After Vercel is Ready, open /creator and tap View token + chart."
echo "If TEST3 has no candles yet, make a small Devnet bonding-curve trade."
