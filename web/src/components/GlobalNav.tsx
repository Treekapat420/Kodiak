"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Home" },
  { href: "/explore", label: "Explore" },
  { href: "/launch", label: "Launch" },
  { href: "/dashboard", label: "Dashboard" },
];

export function GlobalNav() {
  const pathname = usePathname();

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-black/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="shrink-0 text-lg font-black tracking-tight text-white"
        >
          Kodiak
        </Link>

        <nav className="flex max-w-full items-center gap-2 overflow-x-auto">
          {links.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname === link.href ||
                  pathname.startsWith(`${link.href}/`);

            return (
              <Link
                key={link.href}
                href={link.href}
                className={`shrink-0 rounded-xl px-3 py-2 text-sm font-black transition ${
                  active
                    ? "bg-emerald-400 text-black"
                    : "border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07]"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
