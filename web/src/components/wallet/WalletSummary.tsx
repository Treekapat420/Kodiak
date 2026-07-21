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
