#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/Kodiak"
WEB="$ROOT/web"

echo "🐻 Installing Kodiak Creator Dashboard foundation..."

if [ ! -f "$WEB/package.json" ]; then
  echo "Error: Kodiak web/package.json was not found."
  exit 1
fi

cd "$WEB"
npm install @upstash/redis

mkdir -p src/lib/server src/app/api/creator/launches src/app/api/config src/app/creator

cat > src/lib/server/redis.ts <<'EOF'
import "server-only";
import { Redis } from "@upstash/redis";

const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;

if (!url || !token) {
  throw new Error("KV_REST_API_URL and KV_REST_API_TOKEN are required.");
}

export const redis = new Redis({ url, token });
EOF

cat > src/app/api/config/route.ts <<'EOF'
import { NextResponse } from "next/server";
import { redis } from "@/lib/server/redis";

export const runtime = "nodejs";

const key = "kodiak:config:v1";

const defaults = {
  version: 1,
  network: "devnet",
  tradingFeeBps: 120,
  infrastructureFeeBps: 25,
  regularCreatorFeeBps: 45,
  regularKodiakFeeBps: 50,
  foundingCreatorFeeBps: 50,
  foundingKodiakFeeBps: 45,
  foundingCreatorLimit: 100,
  creatorSuccessFundPercentOfKodiakRevenue: 5,
  foundingProgramEnabled: true,
  maintenanceMode: false,
};

export async function GET() {
  const stored = await redis.get<Record<string, unknown>>(key);
  if (!stored) {
    await redis.set(key, defaults);
    return NextResponse.json(defaults);
  }
  return NextResponse.json({ ...defaults, ...stored });
}
EOF

cat > src/app/api/creator/launches/route.ts <<'EOF'
import { NextRequest, NextResponse } from "next/server";
import { clusterApiUrl, Connection, PublicKey } from "@solana/web3.js";
import { redis } from "@/lib/server/redis";

export const runtime = "nodejs";

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

const connection = new Connection(
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || clusterApiUrl("devnet"),
  "confirmed",
);

const creatorKey = (creator: string) => `kodiak:creator:${creator}:launches`;
const launchKey = (mint: string) => `kodiak:launch:${mint}`;

function parseKey(value: string) {
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const creator = parseKey(
    request.nextUrl.searchParams.get("creator")?.trim() ?? "",
  );

  if (!creator) {
    return NextResponse.json(
      { error: "A valid creator wallet is required." },
      { status: 400 },
    );
  }

  const mints = await redis.lrange<string>(
    creatorKey(creator.toBase58()),
    0,
    99,
  );

  const launches = (
    await Promise.all(mints.map((mint) => redis.get<LaunchRecord>(launchKey(mint))))
  ).filter((item): item is LaunchRecord => Boolean(item));

  return NextResponse.json({ launches });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      mint?: string;
      creator?: string;
      name?: string;
      symbol?: string;
      signature?: string;
      createdAt?: string;
    };

    const mint = parseKey(body.mint?.trim() ?? "");
    const creator = parseKey(body.creator?.trim() ?? "");
    const signature = body.signature?.trim() ?? "";

    if (!mint || !creator || signature.length < 64) {
      return NextResponse.json(
        { error: "Mint, creator wallet, and launch signature are required." },
        { status: 400 },
      );
    }

    const [mintAccount, transaction] = await Promise.all([
      connection.getAccountInfo(mint, "confirmed"),
      connection.getParsedTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      }),
    ]);

    if (!mintAccount) {
      return NextResponse.json(
        { error: "The mint was not found on Devnet." },
        { status: 404 },
      );
    }

    if (!transaction || transaction.meta?.err) {
      return NextResponse.json(
        { error: "The launch transaction was not found or failed." },
        { status: 400 },
      );
    }

    const keys = transaction.transaction.message.accountKeys;
    const feePayer = keys.find((entry) => entry.signer)?.pubkey;
    const containsMint = keys.some((entry) => entry.pubkey.equals(mint));

    if (!feePayer?.equals(creator) || !containsMint) {
      return NextResponse.json(
        { error: "This wallet could not be verified as the launch signer." },
        { status: 403 },
      );
    }

    const creatorAddress = creator.toBase58();
    const mintAddress = mint.toBase58();
    const existing = await redis.get<LaunchRecord>(launchKey(mintAddress));

    if (existing && existing.creator !== creatorAddress) {
      return NextResponse.json(
        { error: "This launch is assigned to another creator." },
        { status: 409 },
      );
    }

    const record: LaunchRecord = {
      mint: mintAddress,
      creator: creatorAddress,
      name: body.name?.trim() || "Unnamed Kodiak launch",
      symbol: body.symbol?.replace("$", "").trim().toUpperCase() || "TOKEN",
      signature,
      network: "devnet",
      createdAt: body.createdAt || new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
    };

    await redis.set(launchKey(mintAddress), record);
    if (!existing) {
      await redis.lpush(creatorKey(creatorAddress), mintAddress);
    }

    return NextResponse.json({ launch: record });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to register launch.",
      },
      { status: 500 },
    );
  }
}
EOF

cat > src/app/creator/page.tsx <<'EOF'
"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { KodiakWalletButton } from "@/components/wallet/KodiakWalletButton";

type SavedLaunch = {
  mint?: string;
  signatures?: string[];
  name?: string;
  symbol?: string;
  createdAt?: string;
};

type LaunchRecord = {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  signature: string;
  createdAt: string;
};

type FeeConfig = {
  tradingFeeBps: number;
  infrastructureFeeBps: number;
  regularCreatorFeeBps: number;
  regularKodiakFeeBps: number;
  foundingCreatorFeeBps: number;
  foundingKodiakFeeBps: number;
  foundingCreatorLimit: number;
  creatorSuccessFundPercentOfKodiakRevenue: number;
  foundingProgramEnabled: boolean;
};

type Status = {
  kind: "idle" | "working" | "success" | "error";
  message: string;
};

const percent = (value: number) => `${(value / 100).toFixed(2)}%`;

export default function CreatorPage() {
  const { connected, publicKey } = useWallet();
  const [launches, setLaunches] = useState<LaunchRecord[]>([]);
  const [config, setConfig] = useState<FeeConfig | null>(null);
  const [status, setStatus] = useState<Status>({
    kind: "idle",
    message: "Connect the creator wallet, then sync its latest Kodiak launch.",
  });

  const refresh = async () => {
    if (!publicKey) {
      setStatus({ kind: "error", message: "Connect a creator wallet first." });
      return;
    }

    try {
      setStatus({ kind: "working", message: "Loading creator dashboard…" });
      const address = publicKey.toBase58();
      const [launchResponse, configResponse] = await Promise.all([
        fetch(`/api/creator/launches?creator=${encodeURIComponent(address)}`, {
          cache: "no-store",
        }),
        fetch("/api/config", { cache: "no-store" }),
      ]);

      const launchData = (await launchResponse.json()) as {
        launches?: LaunchRecord[];
        error?: string;
      };
      const configData = (await configResponse.json()) as FeeConfig & {
        error?: string;
      };

      if (!launchResponse.ok) throw new Error(launchData.error);
      if (!configResponse.ok) throw new Error(configData.error);

      setLaunches(launchData.launches ?? []);
      setConfig(configData);
      setStatus({ kind: "success", message: "Creator dashboard refreshed." });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Refresh failed.",
      });
    }
  };

  const syncLastLaunch = async () => {
    if (!publicKey) {
      setStatus({
        kind: "error",
        message: "Connect the wallet that created the token.",
      });
      return;
    }

    try {
      const raw = window.localStorage.getItem("kodiak-last-devnet-launch");
      if (!raw) {
        throw new Error(
          "No saved launch was found in this browser. Use the browser that launched the token.",
        );
      }

      const saved = JSON.parse(raw) as SavedLaunch;
      const signature = saved.signatures?.[0];

      if (!saved.mint || !signature) {
        throw new Error("The saved launch is missing its mint or signature.");
      }

      setStatus({
        kind: "working",
        message: "Verifying the launch on Solana Devnet…",
      });

      const response = await fetch("/api/creator/launches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mint: saved.mint,
          creator: publicKey.toBase58(),
          name: saved.name,
          symbol: saved.symbol,
          signature,
          createdAt: saved.createdAt,
        }),
      });

      const data = (await response.json()) as {
        launch?: LaunchRecord;
        error?: string;
      };

      if (!response.ok || !data.launch) {
        throw new Error(data.error || "Launch registration failed.");
      }

      await refresh();
      setStatus({
        kind: "success",
        message: "Launch verified and added to your creator dashboard.",
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Sync failed.",
      });
    }
  };

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="rounded-3xl border border-emerald-400/20 bg-white/[0.03] p-6">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.24em] text-emerald-300">
                Kodiak Creator
              </p>
              <h1 className="mt-2 text-4xl font-black">Creator Dashboard</h1>
              <p className="mt-3 max-w-2xl text-zinc-400">
                Verified Devnet launches and the current Kodiak fee model.
              </p>
            </div>
            <KodiakWalletButton />
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void syncLastLaunch()}
              disabled={!connected || status.kind === "working"}
              className="rounded-2xl bg-gradient-to-r from-emerald-400 to-amber-300 px-5 py-4 font-black text-black disabled:opacity-40"
            >
              Sync Last Kodiak Launch
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={!connected || status.kind === "working"}
              className="rounded-2xl border border-white/10 px-5 py-4 font-black disabled:opacity-40"
            >
              Refresh Dashboard
            </button>
          </div>
        </header>

        <section
          className={`rounded-2xl border p-4 text-sm ${
            status.kind === "error"
              ? "border-red-400/25 bg-red-400/[0.06] text-red-100"
              : status.kind === "success"
                ? "border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-100"
                : "border-white/10 bg-white/[0.03] text-zinc-400"
          }`}
        >
          <p className="font-bold">{status.message}</p>
        </section>

        {config && (
          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-2xl font-black">Current fee model</h2>
            <p className="mt-2 text-sm text-zinc-500">
              Database configuration only. On-chain enforcement will be audited
              separately before Mainnet.
            </p>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
                <p className="font-black text-emerald-300">Regular launch</p>
                <div className="mt-4 space-y-2 text-sm">
                  <p className="flex justify-between"><span>Creator</span><strong>{percent(config.regularCreatorFeeBps)}</strong></p>
                  <p className="flex justify-between"><span>Kodiak + Success Fund</span><strong>{percent(config.regularKodiakFeeBps)}</strong></p>
                  <p className="flex justify-between"><span>Infrastructure</span><strong>{percent(config.infrastructureFeeBps)}</strong></p>
                  <p className="flex justify-between border-t border-white/10 pt-2"><span>Total</span><strong>{percent(config.tradingFeeBps)}</strong></p>
                </div>
              </div>

              <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.04] p-5">
                <p className="font-black text-amber-300">Founding Creator</p>
                <div className="mt-4 space-y-2 text-sm">
                  <p className="flex justify-between"><span>Creator</span><strong>{percent(config.foundingCreatorFeeBps)}</strong></p>
                  <p className="flex justify-between"><span>Kodiak + Success Fund</span><strong>{percent(config.foundingKodiakFeeBps)}</strong></p>
                  <p className="flex justify-between"><span>Infrastructure</span><strong>{percent(config.infrastructureFeeBps)}</strong></p>
                  <p className="flex justify-between border-t border-white/10 pt-2"><span>Total</span><strong>{percent(config.tradingFeeBps)}</strong></p>
                </div>
              </div>
            </div>

            <p className="mt-4 text-sm text-zinc-400">
              Success Fund: <strong className="text-white">{config.creatorSuccessFundPercentOfKodiakRevenue}%</strong> of Kodiak revenue.
            </p>
          </section>
        )}

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-2xl font-black">Verified launches</h2>
            <p className="text-sm font-bold text-emerald-300">
              {launches.length} launch{launches.length === 1 ? "" : "es"}
            </p>
          </div>

          {launches.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-white/10 p-8 text-center text-zinc-500">
              No verified launches loaded yet.
            </div>
          ) : (
            <div className="mt-5 grid gap-4">
              {launches.map((launch, index) => {
                const founding =
                  Boolean(config?.foundingProgramEnabled) &&
                  index < (config?.foundingCreatorLimit ?? 100);

                return (
                  <article
                    key={launch.mint}
                    className="rounded-2xl border border-white/10 bg-black/30 p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-xl font-black">
                          {launch.name} · ${launch.symbol}
                        </p>
                        <p className="mt-2 break-all font-mono text-xs text-zinc-500">
                          {launch.mint}
                        </p>
                      </div>
                      <span className={founding ? "rounded-full bg-amber-300/15 px-3 py-1 text-xs font-black text-amber-300" : "rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-300"}>
                        {founding ? "Founding Creator candidate" : "Regular launch"}
                      </span>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-3">
                      <a href={`https://explorer.solana.com/address/${launch.mint}?cluster=devnet`} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-amber-300">
                        View token
                      </a>
                      <a href={`https://explorer.solana.com/tx/${launch.signature}?cluster=devnet`} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-zinc-300">
                        Launch transaction
                      </a>
                      <a href="/trade" className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-emerald-300">
                        Trade on Devnet
                      </a>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-amber-300/20 bg-amber-300/[0.04] p-6">
          <h2 className="text-xl font-black text-amber-300">Metrics coming next</h2>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            Bonding progress, SOL raised, holders, volume, and claimable creator
            fees require dedicated on-chain indexing and claim-account integration.
            Kodiak will not display invented estimates.
          </p>
        </section>
      </div>
    </main>
  );
}
EOF

npm run lint
npm run build

cd "$ROOT"
git add web/package.json web/package-lock.json web/src/lib/server/redis.ts web/src/app/api/config/route.ts web/src/app/api/creator/launches/route.ts web/src/app/creator/page.tsx
git commit -m "add database-backed creator dashboard foundation" || true
git push origin main

echo ""
echo "✅ Creator Dashboard foundation installed and pushed."
echo "After Vercel is Ready, open your real Kodiak URL followed by /creator."
echo "Connect the wallet used for TEST1, then tap Sync Last Kodiak Launch."
