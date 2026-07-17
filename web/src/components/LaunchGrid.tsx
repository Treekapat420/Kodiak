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
