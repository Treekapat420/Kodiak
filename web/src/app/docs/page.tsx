import Link from "next/link";

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-[#070707] px-5 py-10 text-zinc-100">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-black">How Kodiak works</h1>
          <Link href="/" className="rounded-xl border border-white/10 px-4 py-2">Back home</Link>
        </div>
        <div className="mt-10 space-y-4 text-zinc-400">
          <p>1. Create your token.</p>
          <p>2. Open the bonding curve.</p>
          <p>3. Grow the market and community.</p>
          <p>4. Graduate liquidity to Raydium.</p>
        </div>
      </div>
    </main>
  );
}
