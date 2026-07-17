import { FeeSection } from "@/components/FeeSection";
import { Footer } from "@/components/Footer";
import { Hero } from "@/components/Hero";
import { LaunchGrid } from "@/components/LaunchGrid";
import { Navbar } from "@/components/Navbar";
import { Stats } from "@/components/Stats";
import { WhyKodiak } from "@/components/WhyKodiak";

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#070707] text-zinc-100">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute left-1/2 top-[-18rem] h-[38rem] w-[38rem] -translate-x-1/2 rounded-full bg-amber-500/10 blur-[120px]" />
        <div className="absolute right-[-12rem] top-[34rem] h-[28rem] w-[28rem] rounded-full bg-emerald-500/5 blur-[120px]" />
      </div>

      <Navbar />
      <Hero />
      <Stats />
      <LaunchGrid />
      <WhyKodiak />
      <FeeSection />
      <Footer />
    </main>
  );
}
