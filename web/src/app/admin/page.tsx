"use client";

import { useWallet } from "@solana/wallet-adapter-react";

import { ClaimPlatformRevenue } from "@/components/creator/ClaimPlatformRevenue";
import { GraduationDiagnostics } from "@/components/admin/GraduationDiagnostics";
import { isKodiakAdminWallet } from "@/lib/admin";

export default function AdminPage() {
  const { publicKey, connected } = useWallet();

  const wallet = publicKey?.toBase58() ?? "";
  const isAdmin = isKodiakAdminWallet(wallet);

  if (!connected) {
    return (
      <main className="min-h-screen bg-[#070707] px-4 py-8 text-zinc-100 sm:px-6">
        <div className="mx-auto max-w-4xl">
          <section className="rounded-[2rem] border border-white/10 bg-white/[0.025] p-6">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">
              Kodiak admin
            </p>
            <h1 className="mt-2 text-3xl font-black">
              Connect the authorized wallet
            </h1>
            <p className="mt-3 text-sm text-zinc-500">
              Admin tools are available only to Kodiak&apos;s authorized platform wallet.
            </p>
          </section>
        </div>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-[#070707] px-4 py-8 text-zinc-100 sm:px-6">
        <div className="mx-auto max-w-4xl">
          <section className="rounded-[2rem] border border-rose-400/20 bg-rose-400/[0.04] p-6">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-rose-300">
              Access denied
            </p>
            <h1 className="mt-2 text-3xl font-black">
              This wallet is not a Kodiak admin
            </h1>
            <p className="mt-3 break-all text-sm text-zinc-500">
              Connected wallet: {wallet}
            </p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#070707] px-4 py-8 text-zinc-100 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <header className="rounded-[2rem] border border-amber-300/20 bg-gradient-to-br from-amber-300/10 via-white/[0.03] to-emerald-400/10 p-6 sm:p-9">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-amber-300">
            Kodiak admin
          </p>

          <h1 className="mt-3 text-4xl font-black">
            Platform Command Center
          </h1>

          <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">
            Private Mainnet controls for Kodiak platform revenue and administrative operations.
          </p>

          <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-600">
              Authorized wallet
            </p>
            <p className="mt-2 break-all font-black text-zinc-200">
              {wallet}
            </p>
          </div>
        </header>

        <GraduationDiagnostics />

        <ClaimPlatformRevenue />
      </div>
    </main>
  );
}
