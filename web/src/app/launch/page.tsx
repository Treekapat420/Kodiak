import Link from "next/link";

export default function LaunchPage() {
  return (
    <main className="min-h-screen bg-[#070707] px-5 py-10 text-zinc-100">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-black">Launch a token</h1>
          <Link href="/" className="rounded-xl border border-white/10 px-4 py-2">Back home</Link>
        </div>

        <div className="mt-10 space-y-5 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <input className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3" placeholder="Token name" />
          <input className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3" placeholder="Ticker" />
          <textarea className="min-h-32 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3" placeholder="Description" />
          <button type="button" className="w-full rounded-2xl bg-gradient-to-r from-amber-300 to-orange-500 px-6 py-4 font-black text-zinc-950">
            Connect wallet to continue
          </button>
        </div>
      </div>
    </main>
  );
}
