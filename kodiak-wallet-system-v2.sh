#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/Kodiak"
WEB="$ROOT/web"

echo "🐻 Installing Kodiak Wallet System v2..."

if [ ! -f "$WEB/package.json" ]; then
  echo "Error: Kodiak web/package.json was not found."
  exit 1
fi

cd "$WEB"

npm install @solana/wallet-adapter-phantom @solana/wallet-adapter-solflare @solana/wallet-adapter-coinbase

mkdir -p src/providers src/components/wallet

cat > src/providers/SolanaProvider.tsx <<'EOF'
"use client";

import { useMemo } from "react";
import { clusterApiUrl } from "@solana/web3.js";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { CoinbaseWalletAdapter } from "@solana/wallet-adapter-coinbase";

export function SolanaProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const endpoint = useMemo(
    () =>
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
      clusterApiUrl("devnet"),
    [],
  );

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter({ network: "devnet" }),
      new CoinbaseWalletAdapter(),
    ],
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
EOF

cat > src/components/wallet/KodiakWalletButton.tsx <<'EOF'
"use client";

import { useMemo, useState } from "react";
import {
  WalletDisconnectButton,
  WalletMultiButton,
} from "@solana/wallet-adapter-react-ui";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

function shortAddress(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function KodiakWalletButton() {
  const { connection } = useConnection();
  const { connected, publicKey, wallet } = useWallet();
  const [showDetails, setShowDetails] = useState(false);

  const explorerUrl = useMemo(() => {
    if (!publicKey) return null;
    return `https://explorer.solana.com/address/${publicKey.toBase58()}?cluster=devnet`;
  }, [publicKey]);

  if (!connected || !publicKey) {
    return (
      <div className="flex flex-col items-stretch gap-2 sm:items-end">
        <WalletMultiButton className="!h-auto !rounded-xl !bg-emerald-400 !px-5 !py-3 !font-black !text-black hover:!bg-emerald-300">
          Select Wallet
        </WalletMultiButton>
        <p className="max-w-[260px] text-xs leading-5 text-zinc-500">
          Supports installed Wallet Standard wallets, including Jupiter,
          Backpack, Phantom, and Solflare.
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShowDetails((current) => !current)}
        className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-left"
      >
        <span className="block text-xs font-bold uppercase tracking-wider text-emerald-300">
          Devnet · {wallet?.adapter.name ?? "Wallet"}
        </span>
        <span className="mt-1 block font-mono text-sm font-black text-white">
          {shortAddress(publicKey.toBase58())}
        </span>
      </button>

      {showDetails && (
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-white/10 bg-zinc-950 p-4 shadow-2xl">
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">
            Connected wallet
          </p>
          <p className="mt-2 break-all font-mono text-xs text-zinc-300">
            {publicKey.toBase58()}
          </p>
          <p className="mt-3 text-xs text-zinc-500">
            RPC: {connection.rpcEndpoint.includes("devnet") ? "Devnet" : "Custom"}
          </p>

          <div className="mt-4 grid gap-2">
            {explorerUrl && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-white/10 px-3 py-2 text-center text-sm font-bold text-amber-300"
              >
                View on Explorer
              </a>
            )}

            <WalletMultiButton className="!h-auto !w-full !justify-center !rounded-xl !bg-white/10 !px-3 !py-2 !text-sm !font-bold hover:!bg-white/15">
              Change Wallet
            </WalletMultiButton>

            <WalletDisconnectButton className="!h-auto !w-full !justify-center !rounded-xl !bg-red-400/10 !px-3 !py-2 !text-sm !font-bold !text-red-200 hover:!bg-red-400/20">
              Disconnect
            </WalletDisconnectButton>
          </div>
        </div>
      )}
    </div>
  );
}
EOF

python - <<'PY'
from pathlib import Path

layout = Path("src/app/layout.tsx")
text = layout.read_text()
style_import = 'import "@solana/wallet-adapter-react-ui/styles.css";'

if style_import not in text:
    lines = text.splitlines()
    insert_at = 0
    for index, line in enumerate(lines):
        if line.startswith("import "):
            insert_at = index + 1
    lines.insert(insert_at, style_import)
    layout.write_text("\n".join(lines) + "\n")
PY

npm run lint
npm run build

cd "$ROOT"

git add web/package.json web/package-lock.json web/src/providers/SolanaProvider.tsx web/src/components/wallet/KodiakWalletButton.tsx web/src/app/layout.tsx
git commit -m "add Kodiak multi-wallet connection system" || true
git push origin main

echo ""
echo "✅ Kodiak Wallet System v2 installed and pushed."
echo "Desktop Wallet Standard wallets, including Jupiter Extension and Backpack,"
echo "will be discovered automatically."
echo "On iPhone, open Kodiak in the Jupiter or Phantom in-app browser."
