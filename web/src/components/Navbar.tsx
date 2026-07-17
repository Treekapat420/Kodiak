import Link from "next/link";
import { KodiakWalletButton } from "@/components/wallet/KodiakWalletButton";

const links = [
  { href: "/explore", label: "Explore" },
  { href: "/launch", label: "Launch" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/docs", label: "Docs" },
];

export function Navbar() {
  return (
    <>
      <header className="relative z-20 border-b border-white/5 bg-black/30 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            <img
              src="/kodiak-logo.jpeg"
              alt="Kodiak"
              className="h-12 w-12 shrink-0 rounded-2xl object-cover"
            />
            <div className="min-w-0">
              <p className="truncate text-lg font-black tracking-[0.12em]">KODIAK</p>
              <p className="truncate text-[10px] uppercase tracking-[0.25em] text-zinc-500">
                Solana Launchpad
              </p>
            </div>
          </Link>

          <nav className="hidden items-center gap-7 text-sm text-zinc-400 md:flex">
            {links.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-white">
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="shrink-0">
            <KodiakWalletButton />
          </div>
        </div>

        <nav className="grid grid-cols-4 border-t border-white/5 bg-black/40 md:hidden">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="px-2 py-3 text-center text-xs font-bold text-zinc-400 transition hover:bg-white/5 hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </header>
    </>
  );
}
