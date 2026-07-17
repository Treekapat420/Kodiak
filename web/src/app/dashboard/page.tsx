import Link from "next/link";

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-[#070707] px-5 py-10 text-zinc-100">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-black">Creator dashboard</h1>
          <Link href="/" className="rounded-xl border border-white/10 px-4 py-2">Back home</Link>
        </div>
        <div className="mt-10 rounded-3xl border border-dashed border-white/15 p-10 text-center text-zinc-400">
          Connect your wallet to view launches and creator earnings.
        </div>
      </div>
    </main>
  );
}
