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
