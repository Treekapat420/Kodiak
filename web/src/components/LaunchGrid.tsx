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
