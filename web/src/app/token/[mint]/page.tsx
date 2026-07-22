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
