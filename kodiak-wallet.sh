#!/usr/bin/env bash
set -euo pipefail

echo "🐻 Installing Kodiak wallet integration..."

if [ ! -d "web" ]; then
  echo "Error: run this from /workspaces/Kodiak."
  exit 1
fi

cd web

npm install \
  @solana/wallet-adapter-base \
  @solana/wallet-adapter-react \
  @solana/wallet-adapter-react-ui

mkdir -p src/providers src/components/wallet src/hooks

cat > src/providers/SolanaProvider.tsx <<'EOF'
"use client";

import { useMemo } from "react";
import { clusterApiUrl } from "@solana/web3.js";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";

import "@solana/wallet-adapter-react-ui/styles.css";

export function SolanaProvider({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(() => {
    return (
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
      clusterApiUrl("devnet")
    );
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
EOF

cat > src/hooks/useSolBalance.ts <<'EOF'
"use client";

import { useCallback, useEffect, useState } from "react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

export function useSolBalance() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setBalance(null);
      return;
    }

    setLoading(true);

    try {
      const lamports = await connection.getBalance(publicKey, "confirmed");
      setBalance(lamports / LAMPORTS_PER_SOL);
    } catch (error) {
      console.error("Unable to load SOL balance:", error);
      setBalance(null);
    } finally {
      setLoading(false);
    }
  }, [connection, publicKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { balance, loading, refresh };
}
EOF

cat > src/components/wallet/KodiakWalletButton.tsx <<'EOF'
"use client";

import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  async () => {
    const module = await import("@solana/wallet-adapter-react-ui");
    return module.WalletMultiButton;
  },
  { ssr: false },
);

export function KodiakWalletButton() {
  return <WalletMultiButton className="kodiak-wallet-button" />;
}
EOF

cat > src/components/wallet/WalletSummary.tsx <<'EOF'
"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { KodiakWalletButton } from "@/components/wallet/KodiakWalletButton";
import { useSolBalance } from "@/hooks/useSolBalance";

function shortenAddress(address: string) {
  return `${address.slice(0, 5)}…${address.slice(-5)}`;
}

export function WalletSummary() {
  const { connected, publicKey, wallet } = useWallet();
  const { balance, loading, refresh } = useSolBalance();

  if (!connected || !publicKey) {
    return (
      <section className="rounded-3xl border border-dashed border-white/15 bg-white/[0.025] p-8 text-center">
        <p className="text-2xl font-black">Connect your Solana wallet</p>
        <p className="mx-auto mt-3 max-w-xl leading-7 text-zinc-400">
          Connect on Devnet to test Kodiak without risking real SOL.
        </p>
        <div className="mt-6 flex justify-center">
          <KodiakWalletButton />
        </div>
      </section>
    );
  }

  return (
    <section className="grid gap-5 md:grid-cols-3">
      <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-6">
        <p className="text-sm text-zinc-500">Connected wallet</p>
        <p className="mt-3 text-xl font-black">
          {wallet?.adapter.name ?? "Solana Wallet"}
        </p>
        <p className="mt-2 font-mono text-sm text-emerald-300">
          {shortenAddress(publicKey.toBase58())}
        </p>
      </article>

      <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-6">
        <p className="text-sm text-zinc-500">Devnet balance</p>
        <p className="mt-3 text-3xl font-black">
          {loading
            ? "Loading…"
            : balance === null
              ? "Unavailable"
              : `${balance.toFixed(4)} SOL`}
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="mt-4 text-sm font-bold text-amber-300"
        >
          Refresh balance
        </button>
      </article>

      <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-6">
        <p className="text-sm text-zinc-500">Network</p>
        <div className="mt-3 flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
          <p className="text-xl font-black">Solana Devnet</p>
        </div>
        <div className="mt-5">
          <KodiakWalletButton />
        </div>
      </article>
    </section>
  );
}
EOF

cat > src/components/Navbar.tsx <<'EOF'
import Link from "next/link";
import { KodiakWalletButton } from "@/components/wallet/KodiakWalletButton";

export function Navbar() {
  return (
    <header className="relative z-20 border-b border-white/5 bg-black/30 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
        <Link href="/" className="flex items-center gap-3">
          <img
            src="/kodiak-logo.jpeg"
            alt="Kodiak"
            className="h-12 w-12 rounded-2xl object-cover"
          />
          <div>
            <p className="text-lg font-black tracking-[0.12em]">KODIAK</p>
            <p className="text-[10px] uppercase tracking-[0.25em] text-zinc-500">
              Solana Launchpad
            </p>
          </div>
        </Link>

        <nav className="hidden items-center gap-7 text-sm text-zinc-400 md:flex">
          <Link href="/explore" className="hover:text-white">Explore</Link>
          <Link href="/launch" className="hover:text-white">Launch</Link>
          <Link href="/docs" className="hover:text-white">Docs</Link>
          <Link href="/dashboard" className="hover:text-white">Dashboard</Link>
        </nav>

        <KodiakWalletButton />
      </div>
    </header>
  );
}
EOF

cat > src/app/dashboard/page.tsx <<'EOF'
import Link from "next/link";
import { WalletSummary } from "@/components/wallet/WalletSummary";

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-[#070707] px-5 py-10 text-zinc-100 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between gap-5">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-emerald-300">
              Creator dashboard
            </p>
            <h1 className="mt-3 text-4xl font-black">Your Kodiak account</h1>
          </div>
          <Link
            href="/"
            className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold"
          >
            Back home
          </Link>
        </div>

        <div className="mt-10">
          <WalletSummary />
        </div>

        <section className="mt-8 grid gap-5 md:grid-cols-3">
          {[
            ["0", "Tokens created"],
            ["0 SOL", "Creator fees earned"],
            ["0 SOL", "Claimable fees"],
          ].map(([value, label]) => (
            <article
              key={label}
              className="rounded-3xl border border-white/10 bg-white/[0.025] p-6"
            >
              <p className="text-3xl font-black">{value}</p>
              <p className="mt-2 text-sm text-zinc-500">{label}</p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
EOF

python - <<'PY'
from pathlib import Path

path = Path("src/app/layout.tsx")
text = path.read_text()

if 'SolanaProvider' not in text:
    lines = text.splitlines()
    last_import = -1
    for index, line in enumerate(lines):
        if line.startswith("import "):
            last_import = index

    lines.insert(
        last_import + 1,
        'import { SolanaProvider } from "@/providers/SolanaProvider";',
    )
    text = "\n".join(lines)

    text = text.replace(
        "<body",
        "<body",
        1,
    )

    body_start = text.find(">", text.find("<body"))
    body_end = text.rfind("</body>")

    if body_start != -1 and body_end != -1:
        original_children = text[body_start + 1:body_end]
        wrapped_children = (
            "\n        <SolanaProvider>"
            + original_children
            + "\n        </SolanaProvider>\n      "
        )
        text = text[:body_start + 1] + wrapped_children + text[body_end:]

    path.write_text(text)
PY

cat >> src/app/globals.css <<'EOF'

/* Kodiak Solana wallet controls */
.kodiak-wallet-button.wallet-adapter-button {
  height: 42px;
  border: 1px solid rgba(52, 211, 153, 0.22);
  border-radius: 12px;
  background: rgba(52, 211, 153, 0.1);
  padding: 0 16px;
  color: rgb(110 231 183);
  font-family: inherit;
  font-size: 14px;
  font-weight: 800;
}

.kodiak-wallet-button.wallet-adapter-button:not([disabled]):hover {
  background: rgba(52, 211, 153, 0.16);
}

.wallet-adapter-modal-wrapper {
  background: #101010;
}

.wallet-adapter-modal-title {
  color: #fafafa;
}
EOF

cat > .env.local.example <<'EOF'
# Kodiak currently defaults to Solana Devnet.
# Add a private RPC provider URL here later for production.
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
EOF

npm run lint
npm run build

cd ..
git add .
git commit -m "add Solana wallet connection and Devnet balance" || true

echo ""
echo "✅ Kodiak wallet integration installed."
echo "Refresh the site, then tap Connect Wallet."
