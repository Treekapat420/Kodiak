"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { ClaimCreatorRewards } from "@/components/creator/ClaimCreatorRewards";

type Launch = {
  mint: string;
  name: string;
  symbol: string;
  trades: number;
  buys: number;
  sells: number;
  volumeSol: number;
};

type Ledger = {
  id: string;
  mint: string;
  side: "buy" | "sell";
  solAmount: number;
  creatorRewardSol: number;
  successFundSol: number;
  timestamp: number;
};

type Payload = {
  launches?: Launch[];
  ledger?: Ledger[];
  totals?: {
    creatorRewardsSol: number;
    kodiakFeesSol: number;
    infraFeesSol: number;
    successFundSol: number;
    trackedVolumeSol: number;
    launchCount: number;
    tradeCount: number;
  };
  error?: string;
};

const fmt = (n: number, digits = 6) =>
  Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: digits });

const short = (s: string) => s ? `${s.slice(0, 4)}…${s.slice(-4)}` : "—";

const ago = (ts: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export default function DashboardPage() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? "";
  const [data, setData] = useState<Payload>({});
  const [status, setStatus] = useState("Connect your wallet to load creator data.");

  useEffect(() => {
    if (!wallet) {
    }

    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(
          `/api/creator/dashboard?wallet=${encodeURIComponent(wallet)}`,
          { cache: "no-store" },
        );
        const payload = (await res.json()) as Payload;
        if (!res.ok) throw new Error(payload.error || "Unable to load dashboard.");
        if (!cancelled) {
          setData(payload);
          setStatus("Live Devnet creator accounting • refreshes every 10 seconds");
        }
      } catch (e) {
        if (!cancelled) setStatus(e instanceof Error ? e.message : "Unable to load dashboard.");
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [wallet]);

  const totals = data.totals ?? {
    creatorRewardsSol: 0,
    kodiakFeesSol: 0,
    infraFeesSol: 0,
    successFundSol: 0,
    trackedVolumeSol: 0,
    launchCount: 0,
    tradeCount: 0,
  };
  const launches = data.launches ?? [];
  const ledger = data.ledger ?? [];

  return (
    <main className="min-h-screen bg-[#070707] px-4 py-8 text-zinc-100 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-emerald-400/10 via-white/[0.03] to-amber-300/10 p-6 sm:p-9">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-emerald-300">
            Creator Dashboard V2
          </p>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-5">
            <div>
              <h1 className="text-4xl font-black sm:text-5xl">Creator Command Center</h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">
                Real launch analytics plus an auditable Devnet accounting ledger for
                creator rewards and Kodiak&apos;s Creator Success Fund.
              </p>
              <p className="mt-2 text-xs font-bold text-zinc-500">{status}</p>
            </div>
            <div className="flex gap-3">
              <Link href="/explore" className="rounded-xl border border-white/10 px-4 py-3 text-sm font-black">
                Explore
              </Link>
              <Link href="/launch" className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-black">
                Launch token
              </Link>
            </div>
          </div>
          <div className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-zinc-600">Connected creator</p>
            <p className="mt-2 break-all font-black">{wallet || "Wallet not connected"}</p>
          </div>
        </header>

        <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Launches" value={String(totals.launchCount)} />
          <Metric label="Recorded trades" value={String(totals.tradeCount)} />
          <Metric label="Tracked volume" value={`${fmt(totals.trackedVolumeSol)} SOL`} />
          <Metric label="Creator tracked" value={`${fmt(totals.creatorRewardsSol, 8)} SOL`} accent />
        </section>

                <ClaimCreatorRewards />

        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card title="Fee ledger totals" eyebrow="Revenue accounting">
            <div className="grid gap-3 sm:grid-cols-2">
              <Box label="Creator tracked" value={`${fmt(totals.creatorRewardsSol, 8)} SOL`} note="0.45% of tracked trades" />
              <Box label="Kodiak accrued" value={`${fmt(totals.kodiakFeesSol, 8)} SOL`} note="0.50% platform accounting" />
              <Box label="Infrastructure" value={`${fmt(totals.infraFeesSol, 8)} SOL`} note="0.25% accounting" />
              <Box label="Success Fund" value={`${fmt(totals.successFundSol, 8)} SOL`} note="5% of Kodiak revenue" />
            </div>
            <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/[0.05] p-4">
              <p className="font-black text-amber-200">Kodiak audit ledger — separate from Raydium&apos;s on-chain vault.</p>
              <p className="mt-2 text-xs leading-6 text-zinc-500">
                The ledger records what would accrue under Kodiak&apos;s current Devnet fee model.
                On-chain fee transfer, escrow, and claims still need to be implemented before mainnet.
              </p>
            </div>
          </Card>

          <Card title="Current fee model" eyebrow="Transparent economics">
            <div className="space-y-3">
              <Row label="Creator" value="0.45%" />
              <Row label="Kodiak" value="0.50%" />
              <Row label="Infrastructure" value="0.25%" />
              <Row label="Creator Success Fund" value="5% of Kodiak revenue" />
            </div>
          </Card>
        </section>

        <section className="mt-6 rounded-[2rem] border border-white/10 bg-white/[0.025] p-5 sm:p-6">
          <h2 className="text-2xl font-black">Your launches</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {launches.length ? launches.map((x) => (
              <Link key={x.mint} href={`/token/${x.mint}`} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <div className="flex justify-between gap-3">
                  <div>
                    <p className="font-black">{x.name}</p>
                    <p className="mt-1 text-xs font-black text-amber-300">${x.symbol}</p>
                  </div>
                  <span className="text-xs text-zinc-600">{short(x.mint)}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Mini label="Volume" value={`${fmt(x.volumeSol)} SOL`} />
                  <Mini label="Trades" value={String(x.trades)} />
                  <Mini label="Buys" value={String(x.buys)} />
                  <Mini label="Sells" value={String(x.sells)} />
                </div>
              </Link>
            )) : (
              <div className="md:col-span-2 xl:col-span-3 rounded-2xl border border-dashed border-white/10 p-10 text-center text-zinc-500">
                No launches found for this connected wallet.
              </div>
            )}
          </div>
        </section>

        <section className="mt-6 rounded-[2rem] border border-white/10 bg-white/[0.025] p-5 sm:p-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">Audit trail</p>
              <h2 className="mt-2 text-2xl font-black">Creator reward ledger</h2>
            </div>
            <span className="text-xs text-zinc-600">{ledger.length} entries</span>
          </div>

          <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
            {ledger.length ? ledger.slice(0, 100).map((e) => (
              <div key={e.id} className="grid gap-3 border-b border-white/[0.06] bg-black/20 p-4 sm:grid-cols-[1fr_auto_auto]">
                <div>
                  <p className="text-sm font-black">{e.side.toUpperCase()} • {short(e.mint)}</p>
                  <p className="mt-1 text-xs text-zinc-600">{fmt(e.solAmount)} SOL trade • {ago(e.timestamp)}</p>
                </div>
                <div className="sm:text-right">
                  <p className="text-xs text-zinc-600">Creator</p>
                  <p className="mt-1 text-sm font-black text-emerald-300">+{fmt(e.creatorRewardSol, 8)} SOL</p>
                </div>
                <div className="sm:text-right">
                  <p className="text-xs text-zinc-600">Success Fund</p>
                  <p className="mt-1 text-sm font-black text-amber-300">+{fmt(e.successFundSol, 8)} SOL</p>
                </div>
              </div>
            )) : (
              <div className="p-10 text-center text-zinc-500">
                Recorded trades on your launches will create ledger entries automatically.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
      <p className="text-[11px] font-black uppercase tracking-[0.15em] text-zinc-600">{label}</p>
      <p className={`mt-2 text-2xl font-black ${accent ? "text-emerald-300" : ""}`}>{value}</p>
    </div>
  );
}

function Card({ title, eyebrow, children }: { title: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[2rem] border border-white/10 bg-white/[0.025] p-5">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-black">{title}</h2>
      <div className="mt-5">{children}</div>
    </div>
  );
}

function Box({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-2 text-xl font-black">{value}</p>
      <p className="mt-1 text-xs text-zinc-600">{note}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
      <span className="text-sm text-zinc-500">{label}</span>
      <span className="text-sm font-black">{value}</span>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
      <p className="text-[10px] uppercase tracking-[0.1em] text-zinc-600">{label}</p>
      <p className="mt-1 text-sm font-black">{value}</p>
    </div>
  );
}
