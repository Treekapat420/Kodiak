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
