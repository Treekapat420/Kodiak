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
