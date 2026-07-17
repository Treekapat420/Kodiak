#!/usr/bin/env bash
set -euo pipefail

if [ ! -d "web" ]; then
  echo "Run this from the main Kodiak repository folder."
  exit 1
fi

mkdir -p web/src/app/{explore,launch,dashboard,docs}

cat > web/src/components/Navbar.tsx <<'EOF'
import Link from "next/link";

export function Navbar() {
  return (
    <header className="relative z-20 border-b border-white/5 bg-black/30 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
        <Link href="/" className="flex items-center gap-3">
          <img src="/kodiak-logo.jpeg" alt="Kodiak" className="h-12 w-12 rounded-2xl object-cover" />
          <div>
            <p className="text-lg font-black tracking-[0.12em]">KODIAK</p>
            <p className="text-[10px] uppercase tracking-[0.25em] text-zinc-500">Solana Launchpad</p>
          </div>
        </Link>

        <nav className="hidden items-center gap-7 text-sm text-zinc-400 md:flex">
          <Link href="/explore" className="hover:text-white">Explore</Link>
          <Link href="/launch" className="hover:text-white">Launch</Link>
          <Link href="/docs" className="hover:text-white">Docs</Link>
          <Link href="/dashboard" className="hover:text-white">Dashboard</Link>
        </nav>

        <Link href="/dashboard" className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-2.5 text-sm font-bold text-emerald-300">
          Connect wallet
        </Link>
      </div>
    </header>
  );
}
EOF

cat > web/src/components/Hero.tsx <<'EOF'
import Link from "next/link";

export function Hero() {
  return (
    <section className="relative z-10 mx-auto grid min-h-[78vh] max-w-7xl items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1.05fr_.95fr]">
      <div>
        <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/[0.08] px-4 py-2 text-sm text-amber-300">
          <span className="h-2 w-2 rounded-full bg-emerald-300" />
          Built on Solana · Powered by Raydium LaunchLab
        </div>

        <h1 className="max-w-4xl text-5xl font-black leading-[0.95] tracking-[-0.055em] sm:text-7xl lg:text-[5.6rem]">
          Launch the next
          <span className="block bg-gradient-to-r from-amber-300 via-yellow-400 to-orange-500 bg-clip-text text-transparent">
            market beast.
          </span>
        </h1>

        <p className="mt-7 max-w-2xl text-lg leading-8 text-zinc-400 sm:text-xl">
          Create a memecoin, open a bonding curve, reward your community, and graduate to Raydium.
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link href="/launch" className="rounded-2xl bg-gradient-to-r from-amber-300 to-orange-500 px-7 py-4 text-center font-black text-zinc-950">
            Create a coin
          </Link>
          <Link href="/explore" className="rounded-2xl border border-white/10 bg-white/5 px-7 py-4 text-center font-bold">
            Explore launches
          </Link>
        </div>
      </div>

      <div className="relative mx-auto w-full max-w-lg">
        <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950/85 p-5">
          <img src="/kodiak-logo.jpeg" alt="Kodiak bear logo" className="h-64 w-full rounded-3xl object-cover" />
          <div className="mt-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-500">Featured launch</p>
              <p className="mt-1 text-xl font-black">$KODIAK</p>
            </div>
            <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300">Trading</span>
          </div>
        </div>
      </div>
    </section>
  );
}
EOF

cat > web/src/components/LaunchGrid.tsx <<'EOF'
import Link from "next/link";
import { LaunchCard } from "@/components/LaunchCard";
import { launches } from "@/data/launches";

export function LaunchGrid() {
  return (
    <section id="launches" className="relative z-10 mx-auto max-w-7xl px-5 py-24 sm:px-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.25em] text-amber-300">Live market</p>
          <h2 className="mt-3 text-4xl font-black">Trending on Kodiak</h2>
        </div>
        <Link href="/explore" className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold">
          View all
        </Link>
      </div>

      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {launches.map((launch) => <LaunchCard key={launch.symbol} launch={launch} />)}
      </div>
    </section>
  );
}
EOF

cat > web/src/app/explore/page.tsx <<'EOF'
import Link from "next/link";
import { launches } from "@/data/launches";
import { LaunchCard } from "@/components/LaunchCard";

export default function ExplorePage() {
  return (
    <main className="min-h-screen bg-[#070707] px-5 py-10 text-zinc-100">
      <div className="mx-auto max-w-7xl">
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-black">Explore launches</h1>
          <Link href="/" className="rounded-xl border border-white/10 px-4 py-2">Back home</Link>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {launches.map((launch) => <LaunchCard key={launch.symbol} launch={launch} />)}
        </div>
      </div>
    </main>
  );
}
EOF

cat > web/src/app/launch/page.tsx <<'EOF'
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
EOF

cat > web/src/app/dashboard/page.tsx <<'EOF'
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
EOF

cat > web/src/app/docs/page.tsx <<'EOF'
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
EOF

cd web
npm run lint
npm run build
cd ..

git add .
git commit -m "wire Kodiak navigation and starter pages" || true

echo "✅ Kodiak buttons are wired. Refresh the website."
