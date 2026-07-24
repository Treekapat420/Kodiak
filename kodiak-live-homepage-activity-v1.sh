#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/Kodiak"
WEB="$ROOT/web"
PAGE="$WEB/src/app/page.tsx"
API="$WEB/src/app/api/activity/route.ts"
COMP="$WEB/src/components/LiveActivity.tsx"

echo "🐻 Installing Kodiak live homepage activity..."

if [ ! -f "$PAGE" ]; then
  echo "Missing homepage: $PAGE"
  exit 1
fi

if [ ! -f "$WEB/src/lib/devnet-market.ts" ]; then
  echo "Missing devnet-market.ts"
  exit 1
fi

mkdir -p "$(dirname "$API")"

cp "$PAGE" "$PAGE.bak-live-activity"

cat > "$API" <<'TS'
import { NextResponse } from "next/server";
import { getTrades, type StoredTrade } from "@/lib/devnet-market";

export const dynamic = "force-dynamic";

type RedisPayload<T> = { result?: T; error?: string };

type LaunchRecord = {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  signature?: string;
  network?: string;
  createdAt?: string;
  verifiedAt?: string;
};

type ActivityItem =
  | {
      id: string;
      type: "launch";
      timestamp: number;
      mint: string;
      name: string;
      symbol: string;
      creator: string;
    }
  | {
      id: string;
      type: "trade";
      timestamp: number;
      mint: string;
      name: string;
      symbol: string;
      wallet: string;
      side: "buy" | "sell";
      solAmount: number;
      tokenAmount: number;
      priceSol: number;
      signature: string;
    };

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) throw new Error("Redis REST environment variables are missing.");

  return { url: url.replace(/\/$/, ""), token };
}

async function redis<T>(command: unknown[]): Promise<T> {
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
    throw new Error(`Redis request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as RedisPayload<T>;
  if (payload.error) throw new Error(payload.error);

  return payload.result as T;
}

function isLaunchRecord(value: unknown): value is LaunchRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<LaunchRecord>;
  return Boolean(record.mint && record.creator && record.name && record.symbol);
}

async function loadAllKeys() {
  let cursor = "0";
  const keys = new Set<string>();

  do {
    const result = await redis<[string, string[]]>([
      "SCAN",
      cursor,
      "MATCH",
      "*",
      "COUNT",
      500,
    ]);

    cursor = result?.[0] ?? "0";
    for (const key of result?.[1] ?? []) keys.add(key);
  } while (cursor !== "0");

  return [...keys];
}

async function readLaunches(keys: string[]) {
  const launches: LaunchRecord[] = [];

  for (const key of keys) {
    if (key.includes(":trades:")) continue;

    try {
      const raw = await redis<unknown>(["GET", key]);
      if (!raw) continue;

      let parsed = raw;
      if (typeof raw === "string") {
        try {
          parsed = JSON.parse(raw);
        } catch {
          continue;
        }
      }

      if (isLaunchRecord(parsed)) launches.push(parsed);
    } catch {
      // Ignore unrelated Redis keys.
    }
  }

  const unique = new Map<string, LaunchRecord>();
  for (const launch of launches) unique.set(launch.mint, launch);

  return [...unique.values()];
}

function tradeTime(trade: StoredTrade) {
  const raw = Number(trade.timestamp || 0);
  return raw > 10_000_000_000 ? Math.floor(raw / 1000) : raw;
}

export async function GET() {
  try {
    const keys = await loadAllKeys();
    const launches = await readLaunches(keys);

    const activity: ActivityItem[] = [];
    let totalTrades = 0;
    let totalVolumeSol = 0;
    let totalBuys = 0;
    let totalSells = 0;

    const tokenStats = await Promise.all(
      launches.map(async (launch) => {
        const trades = await getTrades(launch.mint);
        totalTrades += trades.length;

        let tokenVolume = 0;

        for (const trade of trades) {
          const solAmount = Number(trade.solAmount || 0);
          tokenVolume += solAmount;
          totalVolumeSol += solAmount;

          if (trade.side === "sell") totalSells += 1;
          else totalBuys += 1;
        }

        const recentTrades = [...trades]
          .sort((a, b) => tradeTime(b) - tradeTime(a))
          .slice(0, 10);

        for (const trade of recentTrades) {
          activity.push({
            id: `trade:${trade.signature}`,
            type: "trade",
            timestamp: tradeTime(trade),
            mint: launch.mint,
            name: launch.name,
            symbol: launch.symbol,
            wallet: trade.wallet,
            side: trade.side === "sell" ? "sell" : "buy",
            solAmount: Number(trade.solAmount || 0),
            tokenAmount: Number(trade.tokenAmount || 0),
            priceSol: Number(trade.priceSol || 0),
            signature: trade.signature,
          });
        }

        const created = launch.createdAt ? Date.parse(launch.createdAt) : 0;

        if (created && Number.isFinite(created)) {
          activity.push({
            id: `launch:${launch.mint}`,
            type: "launch",
            timestamp: Math.floor(created / 1000),
            mint: launch.mint,
            name: launch.name,
            symbol: launch.symbol,
            creator: launch.creator,
          });
        }

        return {
          mint: launch.mint,
          name: launch.name,
          symbol: launch.symbol,
          creator: launch.creator,
          createdAt: launch.createdAt,
          tradeCount: trades.length,
          volumeSol: tokenVolume,
          buys: trades.filter((trade) => trade.side !== "sell").length,
          sells: trades.filter((trade) => trade.side === "sell").length,
        };
      }),
    );

    activity.sort((a, b) => b.timestamp - a.timestamp);

    const trending = [...tokenStats]
      .sort((a, b) => (b.tradeCount * 2 + b.volumeSol * 5) - (a.tradeCount * 2 + a.volumeSol * 5))
      .slice(0, 5);

    return NextResponse.json(
      {
        activity: activity.slice(0, 40),
        trending,
        stats: {
          launches: launches.length,
          trades: totalTrades,
          volumeSol: totalVolumeSol,
          buys: totalBuys,
          sells: totalSells,
        },
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load live activity." },
      { status: 500 },
    );
  }
}
TS

cat > "$COMP" <<'TS'
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type TradeActivity = {
  id: string;
  type: "trade";
  timestamp: number;
  mint: string;
  name: string;
  symbol: string;
  wallet: string;
  side: "buy" | "sell";
  solAmount: number;
  tokenAmount: number;
  priceSol: number;
  signature: string;
};

type LaunchActivity = {
  id: string;
  type: "launch";
  timestamp: number;
  mint: string;
  name: string;
  symbol: string;
  creator: string;
};

type Activity = TradeActivity | LaunchActivity;

type Trending = {
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  tradeCount: number;
  volumeSol: number;
  buys: number;
  sells: number;
};

type Payload = {
  activity?: Activity[];
  trending?: Trending[];
  stats?: {
    launches: number;
    trades: number;
    volumeSol: number;
    buys: number;
    sells: number;
  };
  error?: string;
};

function shortAddress(value: string) {
  return value ? `${value.slice(0, 4)}…${value.slice(-4)}` : "—";
}

function formatSol(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 100) return value.toFixed(1);
  if (value >= 1) return value.toFixed(3);
  return value.toFixed(5);
}

function timeAgo(timestamp: number) {
  if (!timestamp) return "now";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
  if (seconds < 10) return "now";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function LiveActivity() {
  const [payload, setPayload] = useState<Payload>({});
  const [status, setStatus] = useState("Connecting to Kodiak activity…");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch("/api/activity", { cache: "no-store" });
        const next = (await response.json()) as Payload;

        if (!response.ok) {
          throw new Error(next.error || "Unable to load live activity.");
        }

        if (!cancelled) {
          setPayload(next);
          setStatus("Live • refreshes automatically");
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : "Unable to load live activity.");
        }
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 8_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const activity = payload.activity ?? [];
  const trending = payload.trending ?? [];
  const stats = payload.stats ?? {
    launches: 0,
    trades: 0,
    volumeSol: 0,
    buys: 0,
    sells: 0,
  };

  const buyRatio = useMemo(() => {
    const total = stats.buys + stats.sells;
    return total ? Math.round((stats.buys / total) * 100) : 0;
  }, [stats.buys, stats.sells]);

  return (
    <section className="relative z-10 px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.26em] text-emerald-300">
              Kodiak market
            </p>
            <h2 className="mt-2 text-3xl font-black sm:text-4xl">
              Live on the mountain
            </h2>
            <p className="mt-2 text-sm text-zinc-500">{status}</p>
          </div>

          <Link
            href="/explore"
            className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-black text-zinc-200 transition hover:border-emerald-400/40"
          >
            Explore all →
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Launches" value={String(stats.launches)} />
          <Stat label="Recorded trades" value={String(stats.trades)} />
          <Stat label="Devnet volume" value={`${formatSol(stats.volumeSol)} SOL`} />
          <Stat label="Buy pressure" value={stats.trades ? `${buyRatio}% buys` : "Waiting"} />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
          <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.025]">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <h3 className="font-black">Live activity</h3>
                <p className="mt-1 text-xs text-zinc-600">
                  Buys, sells, and launches across Kodiak
                </p>
              </div>
              <span className="flex items-center gap-2 text-xs font-black text-emerald-300">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                LIVE
              </span>
            </div>

            <div className="max-h-[520px] overflow-y-auto">
              {activity.length ? (
                activity.map((item) => <ActivityRow key={item.id} item={item} />)
              ) : (
                <div className="px-6 py-14 text-center">
                  <p className="font-black text-zinc-300">Waiting for Kodiak activity</p>
                  <p className="mt-2 text-sm text-zinc-600">
                    New launches and recorded trades will appear here.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-gradient-to-b from-amber-300/[0.06] to-white/[0.02] p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">
                  Bear tracks
                </p>
                <h3 className="mt-2 text-xl font-black">Trending now</h3>
              </div>
              <span className="text-2xl">🐻</span>
            </div>

            <div className="mt-5 space-y-3">
              {trending.length ? (
                trending.map((token, index) => (
                  <Link
                    key={token.mint}
                    href={`/token/${token.mint}`}
                    className="block rounded-2xl border border-white/10 bg-black/25 p-4 transition hover:border-amber-300/30"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-300 font-black text-black">
                          {index + 1}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-black">{token.name}</p>
                          <p className="mt-1 text-xs font-black text-amber-300">
                            ${token.symbol}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-black">{formatSol(token.volumeSol)} SOL</p>
                        <p className="mt-1 text-xs text-zinc-600">
                          {token.tradeCount} trades
                        </p>
                      </div>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-zinc-600">
                  Trending tokens will appear as trading activity builds.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ActivityRow({ item }: { item: Activity }) {
  if (item.type === "launch") {
    return (
      <Link
        href={`/token/${item.mint}`}
        className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4 transition hover:bg-white/[0.03]"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-300/10 text-lg">
          🚀
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black">${item.symbol} launched</p>
          <p className="mt-1 truncate text-xs text-zinc-600">
            by {shortAddress(item.creator)} • {item.name}
          </p>
        </div>
        <span className="shrink-0 text-xs font-bold text-zinc-600">
          {timeAgo(item.timestamp)}
        </span>
      </Link>
    );
  }

  const isBuy = item.side === "buy";

  return (
    <Link
      href={`/token/${item.mint}`}
      className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4 transition hover:bg-white/[0.03]"
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-black ${
          isBuy
            ? "bg-emerald-400/10 text-emerald-300"
            : "bg-rose-400/10 text-rose-300"
        }`}
      >
        {isBuy ? "B" : "S"}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-black">
          <span className={isBuy ? "text-emerald-300" : "text-rose-300"}>
            {isBuy ? "BUY" : "SELL"}
          </span>{" "}
          ${item.symbol}
        </p>
        <p className="mt-1 truncate text-xs text-zinc-600">
          {shortAddress(item.wallet)} • {formatSol(item.solAmount)} SOL
        </p>
      </div>

      <span className="shrink-0 text-xs font-bold text-zinc-600">
        {timeAgo(item.timestamp)}
      </span>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-600">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black text-zinc-100">{value}</p>
    </div>
  );
}
TS

python3 - <<'PY'
from pathlib import Path

page = Path("/workspaces/Kodiak/web/src/app/page.tsx")
text = page.read_text()

import_line = 'import { LiveActivity } from "@/components/LiveActivity";'

if import_line not in text:
    lines = text.splitlines()
    insert_at = 0
    for i, line in enumerate(lines):
        if line.startswith("import "):
            insert_at = i + 1
    lines.insert(insert_at, import_line)
    text = "\n".join(lines) + ("\n" if text.endswith("\n") else "")

if "<LiveActivity />" not in text:
    marker = "      <Stats />"
    if marker not in text:
        raise SystemExit("Could not find <Stats /> in homepage.")
    text = text.replace(marker, marker + "\n      <LiveActivity />", 1)

page.write_text(text)
PY

cd "$WEB"

echo "Running lint..."
npm run lint

echo "Running production build..."
npm run build

cd "$ROOT"

git add web/src/app/api/activity/route.ts web/src/components/LiveActivity.tsx web/src/app/page.tsx
git commit -m "add live homepage activity feed" || true
git push origin main

echo ""
echo "✅ Kodiak live homepage activity installed and pushed."
echo "After Vercel is Ready, open the normal Kodiak homepage."
