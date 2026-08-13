const fees = [
  ["Kodiak platform fee", "0.50%", "Curve trades"],
  ["Raydium protocol fee", "0.25%", "Curve trades"],
  ["Creator fee", "0.45%", "Curve trades · claimable"],
  ["Post-migration creator rewards", "10% LP share", "Fee Key NFT after graduation"],
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
            Kodiak shows its configured fee model before a wallet signs.
            Blockchain expenses are estimates because Solana account and network
            costs can change. Post-graduation creator rewards come from the
            creator&apos;s Fee Key share of CPMM LP fees, not a separate 1.05%
            trading fee.
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
