#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/Kodiak"
WEB="$ROOT/web"
TRADES="$WEB/src/app/api/token/[mint]/trades/route.ts"
LIB="$WEB/src/lib/creator-rewards.ts"
API="$WEB/src/app/api/creator/dashboard/route.ts"
PAGE="$WEB/src/app/dashboard/page.tsx"

echo "🐻 Installing Creator Dashboard V2 + rewards ledger..."

for f in "$TRADES" "$PAGE"; do
  [ -f "$f" ] || { echo "Missing required file: $f"; exit 1; }
done

mkdir -p "$(dirname "$API")"
cp "$TRADES" "$TRADES.bak-rewards-v2"
cp "$PAGE" "$PAGE.bak-rewards-v2"

cat > "$LIB" <<'TS'
import type { StoredTrade } from "@/lib/devnet-market";

type RedisPayload<T> = { result?: T; error?: string };

export type RewardEntry = {
  id: string;
  signature: string;
  mint: string;
  creator: string;
  side: "buy" | "sell";
  solAmount: number;
  creatorRewardSol: number;
  kodiakFeeSol: number;
  infraFeeSol: number;
  successFundSol: number;
  timestamp: number;
  status: "accrued";
  network: "devnet";
};

type LaunchRecord = {
  mint: string;
  creator: string;
  name?: string;
  symbol?: string;
  createdAt?: string;
};

const CREATOR_RATE = 0.0045;
const KODIAK_RATE = 0.005;
const INFRA_RATE = 0.0025;
const SUCCESS_SHARE = 0.05;

function config() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Redis REST environment variables are missing.");
  return { url: url.replace(/\/$/, ""), token };
}

async function redis<T>(command: unknown[]): Promise<T> {
  const { url, token } = config();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Redis request failed: ${res.status}`);
  const body = (await res.json()) as RedisPayload<T>;
  if (body.error) throw new Error(body.error);
  return body.result as T;
}

async function keys() {
  let cursor = "0";
  const out = new Set<string>();
  do {
    const result = await redis<[string, string[]]>([
      "SCAN", cursor, "MATCH", "*", "COUNT", 500,
    ]);
    cursor = result?.[0] ?? "0";
    for (const key of result?.[1] ?? []) out.add(key);
  } while (cursor !== "0");
  return [...out];
}

function isLaunch(v: unknown): v is LaunchRecord {
  if (!v || typeof v !== "object") return false;
  const x = v as Partial<LaunchRecord>;
  return Boolean(x.mint && x.creator);
}

export async function findLaunchByMint(mint: string) {
  for (const key of await keys()) {
    if (
      key.includes(":trades:") ||
      key.startsWith("kodiak:creator:reward:") ||
      key.startsWith("kodiak:creator:ledger:")
    ) continue;

    try {
      const raw = await redis<unknown>(["GET", key]);
      if (!raw) continue;
      let parsed = raw;
      if (typeof raw === "string") {
        try { parsed = JSON.parse(raw); } catch { continue; }
      }
      if (isLaunch(parsed) && parsed.mint === mint) return parsed;
    } catch {}
  }
  return null;
}

function unix(value: number) {
  if (!Number.isFinite(value) || value <= 0) return Math.floor(Date.now() / 1000);
  return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
}

export async function recordCreatorReward(trade: StoredTrade) {
  if (!trade?.signature || !trade?.mint) return null;

  const launch = await findLaunchByMint(trade.mint);
  if (!launch?.creator) return null;

  const solAmount = Number(trade.solAmount || 0);
  if (!Number.isFinite(solAmount) || solAmount <= 0) return null;

  const entry: RewardEntry = {
    id: `reward:${trade.signature}`,
    signature: trade.signature,
    mint: trade.mint,
    creator: launch.creator,
    side: trade.side === "sell" ? "sell" : "buy",
    solAmount,
    creatorRewardSol: solAmount * CREATOR_RATE,
    kodiakFeeSol: solAmount * KODIAK_RATE,
    infraFeeSol: solAmount * INFRA_RATE,
    successFundSol: solAmount * KODIAK_RATE * SUCCESS_SHARE,
    timestamp: unix(Number(trade.timestamp || 0)),
    status: "accrued",
    network: "devnet",
  };

  const created = await redis<string | null>([
    "SET",
    `kodiak:creator:reward:${trade.signature}`,
    JSON.stringify(entry),
    "NX",
  ]);

  if (created) {
    const ledgerKey = `kodiak:creator:ledger:${launch.creator}`;
    await redis<number>(["LPUSH", ledgerKey, JSON.stringify(entry)]);
    await redis<number>(["LTRIM", ledgerKey, 0, 4999]);
  }

  return entry;
}

export async function getCreatorLedger(creator: string) {
  const rows = await redis<string[]>([
    "LRANGE",
    `kodiak:creator:ledger:${creator}`,
    0,
    -1,
  ]);

  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      try { return JSON.parse(row) as RewardEntry; } catch { return null; }
    })
    .filter((x): x is RewardEntry => Boolean(x))
    .sort((a, b) => b.timestamp - a.timestamp);
}
TS

python3 - <<'PY'
from pathlib import Path
p = Path("/workspaces/Kodiak/web/src/app/api/token/[mint]/trades/route.ts")
text = p.read_text()
imp = 'import { recordCreatorReward } from "@/lib/creator-rewards";'
if imp not in text:
    lines = text.splitlines()
    pos = max(i for i,l in enumerate(lines) if l.startswith("import ")) + 1
    lines.insert(pos, imp)
    text = "\n".join(lines) + "\n"

needle = "    await saveTrade(trade);"
replacement = """    await saveTrade(trade);

    try {
      await recordCreatorReward(trade);
    } catch (rewardError) {
      console.error("Creator reward ledger write failed:", rewardError);
    }"""
if replacement not in text:
    if needle not in text:
        raise SystemExit("Could not find saveTrade(trade) in trades route.")
    text = text.replace(needle, replacement, 1)
p.write_text(text)
PY

cat > "$API" <<'TS'
import { NextRequest, NextResponse } from "next/server";
import { getTrades } from "@/lib/devnet-market";
import { getCreatorLedger, recordCreatorReward } from "@/lib/creator-rewards";

export const dynamic = "force-dynamic";

type RedisPayload<T> = { result?: T; error?: string };
type LaunchRecord = {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  createdAt?: string;
};

function config() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Redis REST environment variables are missing.");
  return { url: url.replace(/\/$/, ""), token };
}

async function redis<T>(command: unknown[]): Promise<T> {
  const { url, token } = config();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Redis request failed: ${res.status}`);
  const body = (await res.json()) as RedisPayload<T>;
  if (body.error) throw new Error(body.error);
  return body.result as T;
}

async function allKeys() {
  let cursor = "0";
  const out = new Set<string>();
  do {
    const result = await redis<[string, string[]]>([
      "SCAN", cursor, "MATCH", "*", "COUNT", 500,
    ]);
    cursor = result?.[0] ?? "0";
    for (const key of result?.[1] ?? []) out.add(key);
  } while (cursor !== "0");
  return [...out];
}

function isLaunch(v: unknown): v is LaunchRecord {
  if (!v || typeof v !== "object") return false;
  const x = v as Partial<LaunchRecord>;
  return Boolean(x.mint && x.creator && x.name && x.symbol);
}

async function creatorLaunches(wallet: string) {
  const found: LaunchRecord[] = [];
  for (const key of await allKeys()) {
    if (
      key.includes(":trades:") ||
      key.startsWith("kodiak:creator:reward:") ||
      key.startsWith("kodiak:creator:ledger:")
    ) continue;

    try {
      const raw = await redis<unknown>(["GET", key]);
      if (!raw) continue;
      let parsed = raw;
      if (typeof raw === "string") {
        try { parsed = JSON.parse(raw); } catch { continue; }
      }
      if (
        isLaunch(parsed) &&
        parsed.creator.toLowerCase() === wallet.toLowerCase()
      ) found.push(parsed);
    } catch {}
  }

  return [...new Map(found.map((x) => [x.mint, x])).values()];
}

export async function GET(request: NextRequest) {
  try {
    const wallet = request.nextUrl.searchParams.get("wallet")?.trim();
    if (!wallet) {
      return NextResponse.json({ error: "wallet is required" }, { status: 400 });
    }

    const launches = await creatorLaunches(wallet);

    const enriched = await Promise.all(
      launches.map(async (launch) => {
        const trades = await getTrades(launch.mint);

        // Backfill prior Devnet trades once; SET NX makes this idempotent.
        for (const trade of trades) {
          try { await recordCreatorReward(trade); } catch {}
        }

        const volumeSol = trades.reduce(
          (sum, trade) => sum + Number(trade.solAmount || 0),
          0,
        );

        return {
          ...launch,
          trades: trades.length,
          buys: trades.filter((x) => x.side !== "sell").length,
          sells: trades.filter((x) => x.side === "sell").length,
          volumeSol,
        };
      }),
    );

    const ledger = await getCreatorLedger(wallet);

    const totals = ledger.reduce(
      (a, e) => {
        a.creatorRewardsSol += e.creatorRewardSol;
        a.kodiakFeesSol += e.kodiakFeeSol;
        a.infraFeesSol += e.infraFeeSol;
        a.successFundSol += e.successFundSol;
        a.trackedVolumeSol += e.solAmount;
        return a;
      },
      {
        creatorRewardsSol: 0,
        kodiakFeesSol: 0,
        infraFeesSol: 0,
        successFundSol: 0,
        trackedVolumeSol: 0,
      },
    );

    return NextResponse.json({
      wallet,
      launches: enriched,
      ledger,
      totals: {
        ...totals,
        launchCount: enriched.length,
        tradeCount: enriched.reduce((s, x) => s + x.trades, 0),
      },
      feeModel: {
        creatorRate: 0.0045,
        kodiakRate: 0.005,
        infraRate: 0.0025,
        successFundShareOfKodiak: 0.05,
        claimableOnChain: false,
      },
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load creator dashboard." },
      { status: 500 },
    );
  }
}
TS

cat > "$PAGE" <<'TS'
"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";

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
      setData({});
      setStatus("Connect your wallet to load creator data.");
      return;
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
          <Metric label="Creator accrued" value={`${fmt(totals.creatorRewardsSol, 8)} SOL`} accent />
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card title="Fee ledger totals" eyebrow="Revenue accounting">
            <div className="grid gap-3 sm:grid-cols-2">
              <Box label="Creator accrued" value={`${fmt(totals.creatorRewardsSol, 8)} SOL`} note="0.45% of tracked trades" />
              <Box label="Kodiak accrued" value={`${fmt(totals.kodiakFeesSol, 8)} SOL`} note="0.50% platform accounting" />
              <Box label="Infrastructure" value={`${fmt(totals.infraFeesSol, 8)} SOL`} note="0.25% accounting" />
              <Box label="Success Fund" value={`${fmt(totals.successFundSol, 8)} SOL`} note="5% of Kodiak revenue" />
            </div>
            <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/[0.05] p-4">
              <p className="font-black text-amber-200">Accrued accounting — not claimable SOL yet.</p>
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
TS

cd "$WEB"
echo "Running lint..."
npm run lint
echo "Running production build..."
npm run build

cd "$ROOT"
git add \
  web/src/lib/creator-rewards.ts \
  'web/src/app/api/token/[mint]/trades/route.ts' \
  web/src/app/api/creator/dashboard/route.ts \
  web/src/app/dashboard/page.tsx

git commit -m "add creator dashboard v2 and rewards ledger" || true
git push origin main

echo ""
echo "✅ Creator Dashboard V2 installed and pushed."
echo "✅ Existing Devnet trades backfill idempotently when the creator dashboard loads."
echo "✅ New recorded trades create reward ledger entries automatically."
echo "✅ Creator Success Fund accounting is included."
echo ""
echo "IMPORTANT: these are accrued accounting balances, NOT claimable SOL yet."
