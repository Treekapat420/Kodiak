#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/Kodiak"
WEB="$ROOT/web"

echo "🐻 Installing Kodiak Devnet bonding-curve buy page..."

if [ ! -f "$WEB/package.json" ]; then
  echo "Error: Kodiak web/package.json was not found."
  exit 1
fi

mkdir -p "$WEB/src/app/trade"

cat > "$WEB/src/app/trade/page.tsx" <<'EOF'
"use client";

import { useEffect, useMemo, useState } from "react";
import BN from "bn.js";
import {
  getPdaLaunchpadPoolId,
  PlatformConfig,
  TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { KodiakWalletButton } from "@/components/wallet/KodiakWalletButton";
import {
  DEVNET_LAUNCHPAD_PROGRAM_ID,
  loadDevnetRaydium,
} from "@/lib/raydium/devnet";

type SavedLaunch = {
  mint: string;
  signatures?: string[];
  name?: string;
  symbol?: string;
  createdAt?: string;
};

type Status =
  | { kind: "idle"; message: string }
  | { kind: "working"; message: string }
  | { kind: "success"; message: string; signature?: string }
  | { kind: "error"; message: string; logs?: string[] };

const LAMPORTS_PER_SOL = 1_000_000_000;

function collectSignature(value: unknown): string | undefined {
  if (typeof value === "string" && value.length >= 64) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = collectSignature(item);
      if (found) return found;
    }
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (["txId", "txid", "signature"].includes(key) && typeof item === "string") {
        return item;
      }
      const found = collectSignature(item);
      if (found) return found;
    }
  }
  return undefined;
}

function extractLogs(error: unknown): string[] | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "logs" in error &&
    Array.isArray(error.logs)
  ) {
    return error.logs.filter(
      (entry): entry is string => typeof entry === "string",
    );
  }
  return undefined;
}

export default function TradePage() {
  const { connection } = useConnection();
  const { connected, publicKey, signAllTransactions } = useWallet();

  const [mintText, setMintText] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [buySol, setBuySol] = useState("0.001");
  const [poolIdText, setPoolIdText] = useState("");
  const [estimatedTokens, setEstimatedTokens] = useState<string | null>(null);
  const [walletSol, setWalletSol] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({
    kind: "idle",
    message: "Load a Kodiak Devnet launch to begin.",
  });

  useEffect(() => {
    const raw = window.localStorage.getItem("kodiak-last-devnet-launch");
    if (!raw) return;
    try {
      const launch = JSON.parse(raw) as SavedLaunch;
      if (launch.mint) setMintText(launch.mint);
      if (launch.name) setTokenName(launch.name);
      if (launch.symbol) setTokenSymbol(launch.symbol);
    } catch {
      // Manual mint entry remains available.
    }
  }, []);

  useEffect(() => {
    if (!publicKey) {
      setWalletSol(null);
      return;
    }
    void connection
      .getBalance(publicKey, "confirmed")
      .then((lamports) =>
        setWalletSol((lamports / LAMPORTS_PER_SOL).toFixed(4)),
      )
      .catch(() => setWalletSol(null));
  }, [connection, publicKey, status.kind]);

  const normalizedMint = mintText.trim();

  const mintIsValid = useMemo(() => {
    try {
      return Boolean(new PublicKey(normalizedMint));
    } catch {
      return false;
    }
  }, [normalizedMint]);

  const loadPool = async () => {
    if (!mintIsValid) {
      setStatus({ kind: "error", message: "Enter a valid Solana token mint." });
      return;
    }
    if (!publicKey || !signAllTransactions) {
      setStatus({
        kind: "error",
        message: "Connect Phantom in Devnet mode first.",
      });
      return;
    }

    try {
      setStatus({
        kind: "working",
        message: "Loading the Raydium LaunchLab pool from Devnet…",
      });

      const mintA = new PublicKey(normalizedMint);
      const poolId = getPdaLaunchpadPoolId(
        DEVNET_LAUNCHPAD_PROGRAM_ID,
        mintA,
        NATIVE_MINT,
      ).publicKey;

      const raydium = await loadDevnetRaydium({
        connection,
        owner: publicKey,
        signAllTransactions,
      });

      await raydium.launchpad.getRpcPoolInfo({ poolId });
      setPoolIdText(poolId.toBase58());
      setStatus({
        kind: "success",
        message: "LaunchLab bonding-curve pool loaded from Devnet.",
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to load the LaunchLab pool.",
        logs: extractLogs(error),
      });
    }
  };

  const buyToken = async () => {
    if (!publicKey || !signAllTransactions) {
      setStatus({
        kind: "error",
        message: "Connect Phantom in Devnet mode first.",
      });
      return;
    }

    const solNumber = Number(buySol);
    if (!Number.isFinite(solNumber) || solNumber <= 0 || solNumber > 5) {
      setStatus({
        kind: "error",
        message: "Enter a Devnet SOL amount greater than 0 and no more than 5.",
      });
      return;
    }

    const lamports = Math.round(solNumber * LAMPORTS_PER_SOL);
    if (!Number.isSafeInteger(lamports) || lamports <= 0) {
      setStatus({
        kind: "error",
        message: "The SOL amount could not be converted to lamports.",
      });
      return;
    }

    try {
      setEstimatedTokens(null);
      setStatus({
        kind: "working",
        message: "Loading the live curve and calculating the purchase…",
      });

      const mintA = new PublicKey(normalizedMint);
      const poolId = getPdaLaunchpadPoolId(
        DEVNET_LAUNCHPAD_PROGRAM_ID,
        mintA,
        NATIVE_MINT,
      ).publicKey;

      const raydium = await loadDevnetRaydium({
        connection,
        owner: publicKey,
        signAllTransactions,
      });

      const poolInfo = await raydium.launchpad.getRpcPoolInfo({ poolId });
      const platformAccount = await connection.getAccountInfo(
        poolInfo.platformId,
        "confirmed",
      );

      if (!platformAccount) {
        throw new Error("The pool PlatformConfig account was not found.");
      }

      const platformInfo = PlatformConfig.decode(platformAccount.data);
      const mintInfo = await raydium.token.getTokenInfo(mintA);

      const { transaction, extInfo, execute } =
        await raydium.launchpad.buyToken({
          programId: DEVNET_LAUNCHPAD_PROGRAM_ID,
          mintA,
          mintAProgram: new PublicKey(mintInfo.programId),
          poolInfo,
          slippage: new BN(100),
          configInfo: poolInfo.configInfo,
          platformFeeRate: platformInfo.feeRate,
          txVersion: TxVersion.V0,
          buyAmount: new BN(lamports),
        });

      setEstimatedTokens(extInfo.decimalOutAmount.toString());
      setPoolIdText(poolId.toBase58());
      setStatus({
        kind: "working",
        message: "Simulating the buy before Phantom is allowed to sign…",
      });

      const simulation =
        transaction instanceof VersionedTransaction
          ? await connection.simulateTransaction(transaction, {
              commitment: "confirmed",
              replaceRecentBlockhash: true,
              sigVerify: false,
            })
          : await connection.simulateTransaction(transaction);

      if (simulation.value.err) {
        setStatus({
          kind: "error",
          message: `Buy simulation failed: ${JSON.stringify(
            simulation.value.err,
          )}`,
          logs: simulation.value.logs ?? [],
        });
        return;
      }

      setStatus({
        kind: "working",
        message: "Simulation passed. Approve the Devnet buy in Phantom…",
      });

      const result = await execute({ sendAndConfirm: true });
      const signature = collectSignature(result);

      setStatus({
        kind: "success",
        message: `${buySol} Devnet SOL purchase confirmed on-chain.`,
        signature,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "The Devnet purchase failed.",
        logs: extractLogs(error),
      });
    }
  };

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="rounded-3xl border border-emerald-400/20 bg-white/[0.03] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.24em] text-emerald-300">
                Kodiak Devnet
              </p>
              <h1 className="mt-2 text-4xl font-black">Bonding Curve Buy</h1>
              <p className="mt-3 max-w-xl text-zinc-400">
                Test a real Raydium LaunchLab purchase before adding selling.
              </p>
            </div>
            <KodiakWalletButton />
          </div>
        </header>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-zinc-300">
              Token mint
            </span>
            <input
              value={mintText}
              onChange={(event) => {
                setMintText(event.target.value);
                setPoolIdText("");
                setEstimatedTokens(null);
              }}
              placeholder="Paste a Devnet LaunchLab mint"
              className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-4 font-mono text-sm outline-none focus:border-emerald-400/50"
            />
          </label>

          {(tokenName || tokenSymbol) && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
              <p className="font-black">
                {tokenName || "Kodiak launch"}
                {tokenSymbol
                  ? ` · ${tokenSymbol.startsWith("$") ? tokenSymbol : `$${tokenSymbol}`}`
                  : ""}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => void loadPool()}
            disabled={status.kind === "working" || !connected || !mintIsValid}
            className="mt-5 w-full rounded-2xl border border-emerald-400/30 px-5 py-4 font-black text-emerald-300 disabled:opacity-40"
          >
            Load Devnet Bonding Curve
          </button>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-2xl font-black">Buy with Devnet SOL</h2>
            <p className="text-sm text-zinc-400">
              Wallet: {walletSol ?? "—"} SOL
            </p>
          </div>

          <input
            inputMode="decimal"
            value={buySol}
            onChange={(event) => setBuySol(event.target.value)}
            className="mt-5 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-4 text-2xl font-black outline-none focus:border-emerald-400/50"
          />

          <div className="mt-3 grid grid-cols-4 gap-2">
            {["0.001", "0.01", "0.05", "0.1"].map((amount) => (
              <button
                key={amount}
                type="button"
                onClick={() => setBuySol(amount)}
                className="rounded-xl border border-white/10 bg-black/30 px-2 py-3 text-sm font-bold"
              >
                {amount}
              </button>
            ))}
          </div>

          <p className="mt-4 text-xs leading-5 text-zinc-500">
            Slippage is fixed at 1% for this first Devnet test.
          </p>

          <button
            type="button"
            onClick={() => void buyToken()}
            disabled={status.kind === "working" || !connected || !mintIsValid}
            className="mt-5 w-full rounded-2xl bg-gradient-to-r from-emerald-400 to-amber-300 px-6 py-4 text-lg font-black text-black disabled:opacity-40"
          >
            {status.kind === "working"
              ? "Preparing Devnet buy…"
              : "Buy on Bonding Curve"}
          </button>
        </section>

        {(poolIdText || estimatedTokens) && (
          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-sm">
            <h2 className="text-xl font-black">Live quote</h2>
            {estimatedTokens && (
              <div className="mt-4">
                <p className="text-zinc-500">Estimated token output</p>
                <p className="mt-1 break-all text-2xl font-black text-emerald-300">
                  {estimatedTokens}
                </p>
              </div>
            )}
            {poolIdText && (
              <div className="mt-5">
                <p className="text-zinc-500">LaunchLab pool</p>
                <p className="mt-1 break-all font-mono text-xs">{poolIdText}</p>
                <a
                  href={`https://explorer.solana.com/address/${poolIdText}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-block font-black text-amber-300"
                >
                  View pool on Solana Explorer
                </a>
              </div>
            )}
          </section>
        )}

        <section
          className={`rounded-3xl border p-5 text-sm ${
            status.kind === "error"
              ? "border-red-400/25 bg-red-400/[0.06] text-red-100"
              : status.kind === "success"
                ? "border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-100"
                : "border-white/10 bg-white/[0.03] text-zinc-400"
          }`}
        >
          <p className="font-black">{status.message}</p>
          {status.kind === "success" && status.signature && (
            <a
              href={`https://explorer.solana.com/tx/${status.signature}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block font-black text-amber-300"
            >
              View purchase transaction
            </a>
          )}
          {status.kind === "error" && status.logs && status.logs.length > 0 && (
            <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-black/50 p-4 text-[11px] leading-5 text-zinc-300">
              {status.logs.join("\n")}
            </pre>
          )}
        </section>

        <div className="flex gap-3 pb-8">
          <a
            href="/launch"
            className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-zinc-300"
          >
            Back to Launch
          </a>
        </div>
      </div>
    </main>
  );
}
EOF

cd "$WEB"
npm run lint
npm run build

cd "$ROOT"
git add web/src/app/trade/page.tsx
git commit -m "add Kodiak Devnet bonding curve buy page" || true
git push origin main

echo ""
echo "✅ Devnet bonding-curve buy page installed and pushed."
echo "After Vercel is Ready, open your live Kodiak URL followed by /trade."
echo "Start with 0.001 Devnet SOL."
