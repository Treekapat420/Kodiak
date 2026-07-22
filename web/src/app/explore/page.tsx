"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Launch = {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  network?: string;
  createdAt?: string;
  verifiedAt?: string;
  tradeCount: number;
  buys: number;
  sells: number;
  volumeSol: number;
  latestPriceSol: number;
  latestTradeAt: number;
};

type Filter = "new" | "active" | "volume";

function shortAddress(value: string) {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function formatSol(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 100) return value.toFixed(1);
  if (value >= 1) return value.toFixed(3);
  return value.toFixed(6);
}

function relativeTime(value?: string | number) {
  const timestamp =
    typeof value === "number"
      ? value * 1000
      : value
        ? Date.parse(value)
        : 0;

  if (!timestamp || Number.isNaN(timestamp)) return "Recently";

  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function ExplorePage() {
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("new");
  const [message, setMessage] = useState("Loading live launches…");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch("/api/explore", { cache: "no-store" });
        const payload = (await response.json()) as {
          launches?: Launch[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load Explore.");
        }

        if (!cancelled) {
          const next = payload.launches ?? [];
          setLaunches(next);
          setMessage(
            next.length
              ? `${next.length} live Kodiak launch${next.length === 1 ? "" : "es"}`
              : "No launches have been registered yet.",
          );
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error ? error.message : "Unable to load Explore.",
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
  }, []);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    const matching = launches.filter((launch) => {
      if (!normalized) return true;

      return [
        launch.name,
        launch.symbol,
        launch.mint,
        launch.creator,
      ].some((value) => value.toLowerCase().includes(normalized));
    });

    return [...matching].sort((a, b) => {
      if (filter === "volume") return b.volumeSol - a.volumeSol;
      if (filter === "active") return b.tradeCount - a.tradeCount;

      const aTime =
        a.latestTradeAt ||
        Date.parse(a.createdAt || "") / 1000 ||
        0;
      const bTime =
        b.latestTradeAt ||
        Date.parse(b.createdAt || "") / 1000 ||
        0;

      return bTime - aTime;
    });
  }, [filter, launches, query]);

  const totalVolume = launches.reduce(
    (sum, launch) => sum + launch.volumeSol,
    0,
  );
  const totalTrades = launches.reduce(
    (sum, launch) => sum + launch.tradeCount,
    0,
  );

  return (
    <main className="min-h-screen bg-[#070707] px-4 py-8 text-zinc-100 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-emerald-400/10 via-white/[0.03] to-amber-300/10 p-6 sm:p-10">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.28em] text-emerald-300">
                Live discovery
              </p>
              <h1 className="mt-3 text-4xl font-black sm:text-6xl">
                Explore Kodiak
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-400 sm:text-base">
                Discover new launches, active markets, and the tokens attracting
                the most Devnet volume.
              </p>
            </div>

            <div className="flex gap-3">
              <Link
                href="/"
                className="rounded-xl border border-white/10 px-4 py-3 text-sm font-black"
              >
                Home
              </Link>
              <Link
                href="/launch"
                className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-black"
              >
                Launch token
              </Link>
            </div>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <Metric label="Registered launches" value={String(launches.length)} />
            <Metric label="Recorded trades" value={String(totalTrades)} />
            <Metric label="Devnet volume" value={`${formatSol(totalVolume)} SOL`} />
          </div>
        </header>

        <section className="mt-6 rounded-[2rem] border border-white/10 bg-white/[0.025] p-4 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search token, symbol, mint, or creator"
              className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-4 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-400/50 lg:max-w-xl"
            />

            <div className="flex gap-2 overflow-x-auto">
              {(
                [
                  ["new", "New"],
                  ["active", "Most active"],
                  ["volume", "Top volume"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`shrink-0 rounded-xl px-4 py-3 text-sm font-black ${
                    filter === value
                      ? "bg-emerald-400 text-black"
                      : "border border-white/10 text-zinc-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <p className="mt-4 text-xs text-zinc-500">{message}</p>
        </section>

        <section className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((launch) => (
            <article
              key={launch.mint}
              className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.025] transition hover:-translate-y-1 hover:border-emerald-400/30"
            >
              <div className="h-2 bg-gradient-to-r from-emerald-400 via-amber-300 to-emerald-400" />

              <div className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-300 to-orange-500 text-lg font-black text-black">
                      {launch.symbol.slice(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate text-xl font-black">
                        {launch.name}
                      </h2>
                      <p className="mt-1 font-black text-amber-300">
                        ${launch.symbol}
                      </p>
                    </div>
                  </div>

                  <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-[11px] font-black text-emerald-300">
                    DEVNET
                  </span>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <SmallMetric
                    label="Volume"
                    value={`${formatSol(launch.volumeSol)} SOL`}
                  />
                  <SmallMetric
                    label="Trades"
                    value={String(launch.tradeCount)}
                  />
                  <SmallMetric label="Buys" value={String(launch.buys)} />
                  <SmallMetric label="Sells" value={String(launch.sells)} />
                </div>

                <div className="mt-5 space-y-2 rounded-2xl border border-white/10 bg-black/25 p-4 text-xs">
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-500">Creator</span>
                    <span className="font-bold text-zinc-300">
                      {shortAddress(launch.creator)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-500">Mint</span>
                    <span className="font-bold text-zinc-300">
                      {shortAddress(launch.mint)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-500">Activity</span>
                    <span className="font-bold text-zinc-300">
                      {relativeTime(launch.latestTradeAt || launch.createdAt)}
                    </span>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <Link
                    href={`/token/${launch.mint}`}
                    className="rounded-xl bg-emerald-400 px-4 py-3 text-center text-sm font-black text-black"
                  >
                    View token
                  </Link>
                  <Link
                    href={`/trade?mint=${encodeURIComponent(launch.mint)}`}
                    className="rounded-xl border border-white/10 px-4 py-3 text-center text-sm font-black text-zinc-200"
                  >
                    Trade
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </section>

        {!visible.length ? (
          <div className="mt-6 rounded-[2rem] border border-dashed border-white/10 px-6 py-16 text-center">
            <h2 className="text-xl font-black">No matching launches</h2>
            <p className="mt-2 text-sm text-zinc-500">
              Try another search or create the next Kodiak token.
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-600">
        {label}
      </p>
      <p className="mt-1 font-black text-zinc-200">{value}</p>
    </div>
  );
}
