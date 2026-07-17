import Link from "next/link";
import { launches } from "@/data/launches";
import { LaunchCard } from "@/components/LaunchCard";

export default function ExplorePage() {
  return (
    <main className="min-h-screen bg-[#070707] px-5 py-10 text-zinc-100">
      <div className="mx-auto max-w-7xl">
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-black">Explore launches</h1>
          <Link href="/" className="rounded-xl border border-white/10 px-4 py-2">Back home</Link>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {launches.map((launch) => <LaunchCard key={launch.symbol} launch={launch} />)}
        </div>
      </div>
    </main>
  );
}
