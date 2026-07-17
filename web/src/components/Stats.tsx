const stats = [
  ["1,284", "Total launches"],
  ["$3.8M", "24h volume"],
  ["$184K", "Creator fees paid"],
  ["326", "Graduated tokens"],
];

export function Stats() {
  return (
    <section className="relative z-10 border-y border-white/5 bg-white/[0.018]">
      <div className="mx-auto grid max-w-7xl grid-cols-2 px-5 py-8 sm:px-8 md:grid-cols-4">
        {stats.map(([value, label]) => (
          <div key={label} className="px-4 py-5 text-center">
            <p className="text-2xl font-black sm:text-3xl">{value}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.15em] text-zinc-500">
              {label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
