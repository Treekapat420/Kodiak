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
