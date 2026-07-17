#!/usr/bin/env bash
set -euo pipefail

echo "🐻 Installing Kodiak Phase 2..."

if [ ! -d "web" ]; then
  echo "Error: the web folder was not found."
  echo "Run this from the main Kodiak repository folder."
  exit 1
fi

if [ ! -f "kodiak-logo.jpeg" ]; then
  echo "Error: kodiak-logo.jpeg is missing from the repository root."
  exit 1
fi

mkdir -p web/public
mkdir -p web/src/components
mkdir -p web/src/data

cp kodiak-logo.jpeg web/public/kodiak-logo.jpeg

cat > web/src/data/launches.ts <<'EOF'
export type Launch = {
  symbol: string;
  name: string;
  progress: number;
  marketCap: string;
  volume: string;
  holders: string;
  tag: "Hot" | "Bear Tracks" | "New";
};

export const launches: Launch[] = [
  {
    symbol: "$GRIZZ",
    name: "Grizzly Mode",
    progress: 78,
    marketCap: "$48.2K",
    volume: "$112K",
    holders: "844",
    tag: "Hot",
  },
  {
    symbol: "$HONEY",
    name: "Honey Trap",
    progress: 54,
    marketCap: "$31.7K",
    volume: "$79K",
    holders: "519",
    tag: "Bear Tracks",
  },
  {
    symbol: "$CAVE",
    name: "Cave Club",
    progress: 22,
    marketCap: "$12.4K",
    volume: "$28K",
    holders: "203",
    tag: "New",
  },
];
EOF

cat > web/src/components/Navbar.tsx <<'EOF'
export function Navbar() {
  return (
    <header className="relative z-20 border-b border-white/5 bg-black/30 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
        <a href="#" className="flex items-center gap-3">
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
        </a>

        <nav className="hidden items-center gap-7 text-sm text-zinc-400 md:flex">
          <a href="#launches" className="transition hover:text-white">
            Explore
          </a>
          <a href="#why" className="transition hover:text-white">
            Why Kodiak
          </a>
          <a href="#fees" className="transition hover:text-white">
            Fees
          </a>
        </nav>

        <button
          type="button"
          className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-2.5 text-sm font-bold text-emerald-300 transition hover:bg-emerald-400/15"
        >
          Connect wallet
        </button>
      </div>
    </header>
  );
}
EOF

cat > web/src/components/Hero.tsx <<'EOF'
export function Hero() {
  return (
    <section className="relative z-10 mx-auto grid min-h-[78vh] max-w-7xl items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1.05fr_.95fr]">
      <div>
        <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/[0.08] px-4 py-2 text-sm text-amber-300">
          <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,.8)]" />
          Built on Solana · Powered by Raydium LaunchLab
        </div>

        <h1 className="max-w-4xl text-5xl font-black leading-[0.95] tracking-[-0.055em] sm:text-7xl lg:text-[5.6rem]">
          Launch the next
          <span className="block bg-gradient-to-r from-amber-300 via-yellow-400 to-orange-500 bg-clip-text text-transparent">
            market beast.
          </span>
        </h1>

        <p className="mt-7 max-w-2xl text-lg leading-8 text-zinc-400 sm:text-xl">
          Create a memecoin, open a bonding curve, reward your community, and
          graduate to Raydium from one mobile-first launchpad.
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            className="rounded-2xl bg-gradient-to-r from-amber-300 to-orange-500 px-7 py-4 font-black text-zinc-950 shadow-[0_16px_50px_rgba(245,158,11,.18)] transition hover:scale-[1.02]"
          >
            Create a coin
          </button>
          <a
            href="#launches"
            className="rounded-2xl border border-white/10 bg-white/5 px-7 py-4 text-center font-bold transition hover:bg-white/10"
          >
            Explore launches
          </a>
        </div>

        <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-sm text-zinc-500">
          <span>✓ No separate launch charge</span>
          <span>✓ Transparent creator fees</span>
          <span>✓ Automatic Raydium migration</span>
        </div>
      </div>

      <div className="relative mx-auto w-full max-w-lg">
        <div className="absolute inset-0 rounded-[2.5rem] bg-gradient-to-br from-amber-400/15 to-emerald-500/5 blur-3xl" />
        <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950/85 p-5 shadow-2xl backdrop-blur-xl">
          <img
            src="/kodiak-logo.jpeg"
            alt="Kodiak bear logo"
            className="h-64 w-full rounded-3xl object-cover object-center opacity-95"
          />

          <div className="mt-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-500">Featured launch</p>
              <p className="mt-1 text-xl font-black">$KODIAK</p>
            </div>
            <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300">
              Trading
            </span>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3">
            {[
              ["Market cap", "$62.4K"],
              ["24h volume", "$148K"],
              ["Holders", "1,924"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-white/[0.04] p-3">
                <p className="text-[11px] text-zinc-500">{label}</p>
                <p className="mt-1 text-sm font-bold">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-5">
            <div className="mb-2 flex justify-between text-xs">
              <span className="text-zinc-500">Graduation progress</span>
              <span className="font-bold text-amber-300">83%</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full w-[83%] rounded-full bg-gradient-to-r from-amber-300 to-orange-500" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
EOF

cat > web/src/components/Stats.tsx <<'EOF'
const stats = [
  ["1,284", "Total launches"],
  ["$3.8M", "24h volume"],
  ["$184K", "Creator fees paid"],
  ["326", "Graduated tokens"],
];

export function Stats() {
  return (
    <section className="relative z-10 border-y border-white/5 bg-white/[0.018]">
      <div className="mx-auto grid max-w-7xl grid-cols-2 px-5 py-8 sm:px-8 md:grid-cols-4">
        {stats.map(([value, label]) => (
          <div key={label} className="px-4 py-5 text-center">
            <p className="text-2xl font-black sm:text-3xl">{value}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.15em] text-zinc-500">
              {label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
EOF

cat > web/src/components/LaunchCard.tsx <<'EOF'
import type { Launch } from "@/data/launches";

export function LaunchCard({ launch }: { launch: Launch }) {
  return (
    <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 backdrop-blur transition hover:-translate-y-1 hover:border-amber-400/25">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-300 to-orange-500 font-black text-zinc-950">
            {launch.symbol.slice(1, 3)}
          </div>
          <div>
            <p className="font-bold">{launch.name}</p>
            <p className="text-sm text-zinc-500">{launch.symbol}</p>
          </div>
        </div>

        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300">
          {launch.tag}
        </span>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3 text-sm">
        <div className="rounded-2xl bg-black/30 p-3">
          <p className="text-zinc-500">Market cap</p>
          <p className="mt-1 font-bold">{launch.marketCap}</p>
        </div>
        <div className="rounded-2xl bg-black/30 p-3">
          <p className="text-zinc-500">Volume</p>
          <p className="mt-1 font-bold">{launch.volume}</p>
        </div>
        <div className="rounded-2xl bg-black/30 p-3">
          <p className="text-zinc-500">Holders</p>
          <p className="mt-1 font-bold">{launch.holders}</p>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex justify-between text-xs">
          <span className="text-zinc-500">Bonding curve</span>
          <span className="font-semibold text-amber-300">{launch.progress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-300 to-orange-500"
            style={{ width: `${launch.progress}%` }}
          />
        </div>
      </div>
    </article>
  );
}
EOF

cat > web/src/components/LaunchGrid.tsx <<'EOF'
import { LaunchCard } from "@/components/LaunchCard";
import { launches } from "@/data/launches";

export function LaunchGrid() {
  return (
    <section
      id="launches"
      className="relative z-10 mx-auto max-w-7xl px-5 py-24 sm:px-8"
    >
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.25em] text-amber-300">
            Live market
          </p>
          <h2 className="mt-3 text-4xl font-black tracking-tight">
            Trending on Kodiak
          </h2>
        </div>
        <button
          type="button"
          className="w-fit rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-zinc-300"
        >
          View all launches
        </button>
      </div>

      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {launches.map((launch) => (
          <LaunchCard key={launch.symbol} launch={launch} />
        ))}
      </div>
    </section>
  );
}
EOF

cat > web/src/components/WhyKodiak.tsx <<'EOF'
const features = [
  {
    number: "01",
    title: "Launch in minutes",
    text: "Create a token, add artwork and socials, then open the bonding curve without a separate Kodiak launch charge.",
  },
  {
    number: "02",
    title: "Transparent fee flow",
    text: "Every fee is shown before signing. Creators can track and claim earnings from one dashboard.",
  },
  {
    number: "03",
    title: "Automatic graduation",
    text: "When the curve completes, liquidity migrates to Raydium and the market continues trading.",
  },
];

export function WhyKodiak() {
  return (
    <section
      id="why"
      className="relative z-10 mx-auto max-w-7xl px-5 pb-24 sm:px-8"
    >
      <div className="rounded-[2.2rem] border border-white/10 bg-gradient-to-br from-white/[0.05] to-transparent p-7 sm:p-10">
        <p className="text-sm font-bold uppercase tracking-[0.25em] text-amber-300">
          Built for creators
        </p>
        <h2 className="mt-3 max-w-3xl text-4xl font-black tracking-tight">
          More than a mint button.
        </h2>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.number}
              className="rounded-3xl border border-white/5 bg-black/20 p-6"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-400/10 font-black text-emerald-300">
                {feature.number}
              </div>
              <h3 className="mt-5 text-xl font-black">{feature.title}</h3>
              <p className="mt-3 leading-7 text-zinc-400">{feature.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
EOF

cat > web/src/components/FeeSection.tsx <<'EOF'
const fees = [
  ["Kodiak platform fee", "0.60%", "Curve trades"],
  ["Raydium protocol fee", "0.25%", "Curve trades"],
  ["Creator fee", "0.45%", "Curve trades · claimable"],
  ["Post-migration creator fee", "1.05%", "Creator opt-in"],
];

export function FeeSection() {
  return (
    <section
      id="fees"
      className="relative z-10 mx-auto max-w-7xl px-5 pb-28 sm:px-8"
    >
      <div className="grid gap-7 lg:grid-cols-[.8fr_1.2fr]">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.25em] text-amber-300">
            Clear economics
          </p>
          <h2 className="mt-3 text-4xl font-black tracking-tight">
            No hidden fee traps.
          </h2>
          <p className="mt-5 max-w-xl leading-8 text-zinc-400">
            Kodiak shows costs before a wallet signs. Blockchain expenses are
            estimates because Solana account and network costs can change.
          </p>
        </div>

        <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
          {fees.map(([name, rate, timing]) => (
            <div
              key={name}
              className="grid grid-cols-[1fr_auto] gap-4 border-b border-white/5 p-5 last:border-b-0 sm:grid-cols-[1fr_auto_1fr]"
            >
              <p className="font-bold">{name}</p>
              <p className="font-black text-amber-300">{rate}</p>
              <p className="col-span-2 text-sm text-zinc-500 sm:col-span-1 sm:text-right">
                {timing}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
EOF

cat > web/src/components/Footer.tsx <<'EOF'
export function Footer() {
  return (
    <footer className="relative z-10 border-t border-white/5 px-5 py-8 sm:px-8">
      <div className="mx-auto flex max-w-7xl flex-col justify-between gap-5 text-sm text-zinc-500 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <img
            src="/kodiak-logo.jpeg"
            alt="Kodiak"
            className="h-10 w-10 rounded-xl object-cover"
          />
          <span>© 2026 Kodiak</span>
        </div>
        <p>Built on Solana. Powered by Raydium LaunchLab.</p>
      </div>
    </footer>
  );
}
EOF

cat > web/src/app/page.tsx <<'EOF'
import { FeeSection } from "@/components/FeeSection";
import { Footer } from "@/components/Footer";
import { Hero } from "@/components/Hero";
import { LaunchGrid } from "@/components/LaunchGrid";
import { Navbar } from "@/components/Navbar";
import { Stats } from "@/components/Stats";
import { WhyKodiak } from "@/components/WhyKodiak";

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#070707] text-zinc-100">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute left-1/2 top-[-18rem] h-[38rem] w-[38rem] -translate-x-1/2 rounded-full bg-amber-500/10 blur-[120px]" />
        <div className="absolute right-[-12rem] top-[34rem] h-[28rem] w-[28rem] rounded-full bg-emerald-500/5 blur-[120px]" />
      </div>

      <Navbar />
      <Hero />
      <Stats />
      <LaunchGrid />
      <WhyKodiak />
      <FeeSection />
      <Footer />
    </main>
  );
}
EOF

cat > web/src/app/globals.css <<'EOF'
@import "tailwindcss";

:root {
  --background: #070707;
  --foreground: #f4f4f5;
}

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  background: var(--background);
  color: var(--foreground);
  font-family: Arial, Helvetica, sans-serif;
}

button,
a {
  -webkit-tap-highlight-color: transparent;
}

button {
  cursor: pointer;
}

::selection {
  background: rgba(251, 191, 36, 0.3);
}
EOF

cd web
npm run lint
npm run build
cd ..

git add .
git commit -m "phase 2: premium Kodiak homepage and components" || true

echo ""
echo "✅ Kodiak Phase 2 installed successfully."
echo "If the site is already running, refresh the browser."
echo "Otherwise run: cd web && npm run dev"
