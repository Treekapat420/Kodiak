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

        <div className="mt-6 flex justify-end">
          <Link href="/platform-setup" className="rounded-2xl bg-gradient-to-r from-emerald-400 to-amber-300 px-5 py-3 font-black text-black">
            Set up Kodiak Devnet platform
          </Link>
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
