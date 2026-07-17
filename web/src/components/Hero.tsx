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
