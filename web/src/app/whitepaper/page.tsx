import Link from "next/link";
import { Footer } from "@/components/Footer";

export default function WhitepaperPage() {
  return (
    <>
      <main className="min-h-screen bg-[#070707] px-5 py-10 text-zinc-100 sm:px-8">
        <article className="mx-auto max-w-4xl">
          <div className="rounded-[2rem] border border-amber-300/20 bg-amber-300/[0.05] p-7 sm:p-10">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-200">Kodiak Whitepaper · Public Beta</p>
            <h1 className="mt-4 text-4xl font-black tracking-tight sm:text-6xl">A creator-first launchpad built on Solana.</h1>
            <p className="mt-5 text-lg leading-8 text-zinc-400">Kodiak combines Raydium LaunchLab bonding curves, creator incentives, transparent platform economics, and CPMM graduation into one launch experience.</p>
            <div className="mt-6"><Link href="/docs" className="font-black text-amber-200">← Back to Docs</Link></div>
          </div>

          <div className="mt-8 space-y-8 text-[15px] leading-7 text-zinc-400 sm:text-base">
            <section><h2 className="text-2xl font-black text-white">1. Mission</h2><p className="mt-3">Kodiak is designed to make launching a Solana token straightforward while keeping creators aligned with the communities they build. The platform focuses on simple launches, ongoing creator rewards, transparent fees, and a path from price discovery on a bonding curve to decentralized liquidity.</p></section>
            <section><h2 className="text-2xl font-black text-white">2. Launch architecture</h2><p className="mt-3">Kodiak uses Raydium LaunchLab for pre-graduation markets. New launches use a 1,000,000,000 token supply with 6 decimals. Creators may launch without an initial purchase or include an optional creator buy. Each transaction remains subject to wallet approval and Solana confirmation.</p></section>
            <section><h2 className="text-2xl font-black text-white">3. Bonding curve & price discovery</h2><p className="mt-3">While a token is active in LaunchLab, trades occur against the bonding curve. Purchases and sales change the curve&apos;s on-chain reserves and therefore the token&apos;s spot price. Kodiak reads that state directly for market and graduation information.</p></section>
            <section><h2 className="text-2xl font-black text-white">4. Graduation</h2><p className="mt-3">Kodiak&apos;s current production WSOL launch configuration uses an 85 SOL fundraising target and CPMM migration. The threshold is supplied by the shared Raydium LaunchLab configuration used by Kodiak launches; it is not currently selected independently by each creator. After the target is reached, Kodiak waits for the on-chain graduation transition and verifies the resulting Raydium CPMM pool before treating CPMM trading as active.</p></section>
            <section><h2 className="text-2xl font-black text-white">5. Economics</h2><p className="mt-3">Current bonding-curve trading economics are 0.45% creator fee, 0.50% Kodiak platform fee, and 0.25% Raydium protocol fee, for a 1.20% total. Five percent of Kodiak&apos;s platform revenue is reserved for the Creator Success Fund. At migration, Kodiak&apos;s current configuration burns 90% of migrated LP ownership, assigns 10% to the creator fee-key LP share, and assigns 0% to a Kodiak platform LP share.</p></section>
            <section><h2 className="text-2xl font-black text-white">6. Creator Success Fund</h2><p className="mt-3">The Creator Success Fund is intended to recycle a portion of Kodiak&apos;s success into support for creators and projects. It is not a guaranteed distribution to every launch. Program rules and support mechanisms can evolve as Kodiak moves through beta.</p></section>
            <section><h2 className="text-2xl font-black text-white">7. Open trading environment</h2><p className="mt-3">Kodiak provides a native trading experience but does not require users to trade exclusively through Kodiak. Compatible Solana wallets, applications, and aggregators may expose or route a Kodiak token when they support its active market. Third-party indexing and routing are controlled by those services.</p></section>
            <section><h2 className="text-2xl font-black text-white">8. Safety model</h2><p className="mt-3">Kodiak verifies relevant on-chain LaunchLab state, simulates supported transactions before wallet approval when possible, handles failed simulations without requesting a signature, and requires users to approve transactions in their own wallets. These controls reduce avoidable transaction errors but do not remove smart-contract, market, integration, or blockchain risk.</p></section>
            <section><h2 className="text-2xl font-black text-white">9. Beta & future development</h2><p className="mt-3">Kodiak is in public beta. Fees, launch configurations, creator programs, graduation behavior, integrations, and other platform features may evolve. When configuration changes affect users, the current product and documentation should be treated as the authoritative description of Kodiak&apos;s supported interface.</p></section>
            <section className="rounded-3xl border border-white/10 bg-white/[0.025] p-6"><h2 className="text-2xl font-black text-white">Risk disclosure</h2><p className="mt-3">Digital assets are speculative. Token launches can lose some or all of their value. Solana transactions are irreversible, and third-party protocols and applications have their own risks. Nothing in this whitepaper is investment, legal, or tax advice.</p></section>
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}
