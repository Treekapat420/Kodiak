import Link from "next/link";
import { Footer } from "@/components/Footer";

const sections = [
  ["start", "Getting started"],
  ["launch", "Launch a token"],
  ["trading", "Trading"],
  ["graduation", "Graduation"],
  ["fees", "Fees & rewards"],
  ["fund", "Success Fund"],
  ["safety", "Safety"],
  ["faq", "FAQ"],
] as const;

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 rounded-3xl border border-white/10 bg-white/[0.025] p-6 sm:p-8">
      <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">{title}</h2>
      <div className="mt-5 space-y-4 text-[15px] leading-7 text-zinc-400 sm:text-base">{children}</div>
    </section>
  );
}

export default function DocsPage() {
  return (
    <>
      <main className="min-h-screen bg-[#070707] px-5 py-10 text-zinc-100 sm:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-[2rem] border border-amber-300/20 bg-gradient-to-br from-amber-300/[0.08] via-white/[0.025] to-transparent p-7 sm:p-10">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-amber-200">Kodiak Docs</span>
              <span className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold text-zinc-400">Public Beta</span>
            </div>
            <h1 className="mt-5 text-4xl font-black tracking-tight sm:text-6xl">Learn Kodiak.</h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-zinc-400 sm:text-lg">
              Everything you need to launch a token, understand the bonding curve, trade, earn creator rewards, and follow a project from launch through Raydium graduation.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/launch" className="rounded-xl bg-amber-300 px-5 py-3 text-sm font-black text-black">Launch a token</Link>
              <Link href="/whitepaper" className="rounded-xl border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-black text-white">Read the whitepaper</Link>
            </div>
          </div>

          <nav className="mt-6 flex gap-2 overflow-x-auto pb-2">
            {sections.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-bold text-zinc-300">{label}</a>
            ))}
          </nav>

          <div className="mt-8 space-y-6">
            <Section id="start" title="How Kodiak works">
              <div className="grid gap-3 sm:grid-cols-4">
                {["1. Create", "2. Trade", "3. Grow", "4. Graduate"].map((item) => (
                  <div key={item} className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.05] p-4 font-black text-amber-200">{item}</div>
                ))}
              </div>
              <p>Kodiak is a creator-first token launchpad on Solana powered by Raydium LaunchLab. A creator launches a token into an on-chain bonding curve, the market trades against that curve, and a successful token can graduate into Raydium CPMM liquidity.</p>
              <p>No initial creator purchase is required. A creator may launch with a 0 SOL initial buy or choose to make an initial purchase during launch.</p>
            </Section>

            <Section id="launch" title="How to create a token">
              <ol className="space-y-3">
                <li><strong className="text-white">1. Connect your wallet.</strong> Use a supported Solana wallet and open Kodiak&apos;s Launch page.</li>
                <li><strong className="text-white">2. Build your project.</strong> Add the token name, symbol, description, logo, and optional website/social links.</li>
                <li><strong className="text-white">3. Choose your initial buy.</strong> Enter 0 SOL to launch without buying, or choose an amount you want to purchase at launch.</li>
                <li><strong className="text-white">4. Review everything.</strong> Kodiak shows the launch details before a transaction is prepared.</li>
                <li><strong className="text-white">5. Approve in your wallet.</strong> Your wallet remains in control. Kodiak cannot approve a transaction for you.</li>
                <li><strong className="text-white">6. Go live.</strong> Once confirmed on Solana, the token&apos;s LaunchLab bonding curve is active.</li>
              </ol>
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm">Kodiak&apos;s current launch engine uses a fixed supply of <strong className="text-white">1,000,000,000 tokens</strong> with 6 decimals.</div>
            </Section>

            <Section id="trading" title="Trading before graduation">
              <p>Before graduation, price and available inventory are determined by the token&apos;s Raydium LaunchLab bonding curve. Buying moves the market forward on the curve; selling moves it back.</p>
              <p><strong className="text-white">You are not locked into Kodiak&apos;s interface.</strong> Kodiak provides its own trading interface, but compatible Solana wallets, trading apps, and aggregators may also expose or route trades when they support the token&apos;s active LaunchLab market.</p>
              <p>Availability in third-party products such as wallet swap interfaces or aggregators depends on those services&apos; own indexing and routing support. Kodiak cannot guarantee that every outside app will immediately list or route every new token.</p>
            </Section>

            <Section id="graduation" title="Graduation to Raydium CPMM">
              <p>Kodiak launches currently use Raydium&apos;s mainnet WSOL LaunchLab configuration selected by the launch engine. That configuration sets the bonding target used by each pool.</p>
              <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-5">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-amber-200">Current target</div>
                <div className="mt-2 text-3xl font-black text-white">85 SOL</div>
                <p className="mt-2 text-sm leading-6 text-zinc-400">Under Kodiak&apos;s current production LaunchLab configuration, new WSOL launches use an 85 SOL fundraising target. This is configuration-driven rather than a per-token number chosen by the creator.</p>
              </div>
              <p>When the target is reached, LaunchLab performs the graduation transition and the token moves from bonding-curve trading toward a Raydium CPMM pool. Kodiak monitors the on-chain state and switches trading only after the graduated CPMM pool can be verified.</p>
              <p>The target can change in the future if Kodiak intentionally adopts a different Raydium launch configuration. The live token page is the source to use for a specific token&apos;s progress.</p>
            </Section>

            <Section id="fees" title="Fees & creator rewards">
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["0.45%", "Creator curve fee"],
                  ["0.50%", "Kodiak platform fee"],
                  ["0.25%", "Raydium protocol fee"],
                ].map(([value, label]) => (
                  <div key={label} className="rounded-2xl border border-white/10 bg-black/30 p-5"><div className="text-2xl font-black text-white">{value}</div><div className="mt-1 text-sm text-zinc-500">{label}</div></div>
                ))}
              </div>
              <p>The current curve-trading fee model totals <strong className="text-white">1.20%</strong>. Of that, 0.45% is the creator fee, 0.50% is Kodiak&apos;s platform fee, and 0.25% is the Raydium protocol fee.</p>
              <p>At migration, Kodiak&apos;s current configuration permanently burns 90% of migrated LP ownership and assigns 10% to the creator fee-key LP share. Kodiak&apos;s platform LP share is 0%.</p>
              <p className="text-zinc-500">On-chain Raydium configuration is authoritative for fees actually charged. Kodiak may update its economics in future versions and will update these docs when it does.</p>
            </Section>

            <Section id="fund" title="Creator Success Fund">
              <p>Kodiak reserves <strong className="text-white">5% of Kodiak&apos;s platform revenue</strong> for the Creator Success Fund. The goal is to recycle a portion of platform success back into helping promising projects and creators grow.</p>
              <p>The fund is not a guaranteed payout to every token or creator. Eligibility, selection, timing, and the form of support can vary as the program develops during beta.</p>
            </Section>

            <Section id="safety" title="Safety & transparency">
              <ul className="space-y-3">
                <li>â¢ Your wallet must approve transactions. Kodiak cannot sign for you.</li>
                <li>â¢ Kodiak simulates supported transactions before wallet approval when possible and blocks known failed simulations.</li>
                <li>â¢ LaunchLab and CPMM state are verified on-chain before Kodiak changes trading modes.</li>
                <li>â¢ Blockchain transactions are irreversible. Always verify the token, amount, network, and wallet prompt before signing.</li>
                <li>â¢ Kodiak is in public beta. Smart-contract, integration, market, and third-party risks still exist.</li>
              </ul>
            </Section>

            <Section id="faq" title="Frequently asked questions">
              <div className="space-y-5">
                <div><h3 className="font-black text-white">Do I have to buy my own token?</h3><p>No. Kodiak supports a 0 SOL initial creator buy.</p></div>
                <div><h3 className="font-black text-white">Can I sell before graduation?</h3><p>Yes, while the LaunchLab bonding curve is active and you own tokens available to sell.</p></div>
                <div><h3 className="font-black text-white">Does every Kodiak token currently graduate at 85 SOL?</h3><p>With Kodiak&apos;s current production WSOL LaunchLab configuration, yes. The threshold comes from the shared Raydium launch configuration, not a custom value selected for each token.</p></div>
                <div><h3 className="font-black text-white">Where does a token go after graduation?</h3><p>Kodiak is configured for migration to a Raydium CPMM pool.</p></div>
                <div><h3 className="font-black text-white">Can I trade somewhere besides Kodiak?</h3><p>Yes, when a compatible wallet, app, or aggregator supports and routes the token&apos;s market. Third-party availability is controlled by those services.</p></div>
                <div><h3 className="font-black text-white">Is Kodiak audited?</h3><p>Kodiak should not be represented as independently audited unless and until a completed third-party audit is published. Public beta users should treat the platform accordingly.</p></div>
              </div>
            </Section>

            <section className="rounded-3xl border border-amber-300/25 bg-amber-300/[0.07] p-7 text-center sm:p-10">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-200">Ready to climb?</p>
              <h2 className="mt-3 text-3xl font-black text-white">Climb the mountain. Launch with Kodiak.</h2>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Link href="/launch" className="rounded-xl bg-amber-300 px-5 py-3 text-sm font-black text-black">Launch a token</Link>
                <Link href="/whitepaper" className="rounded-xl border border-white/15 px-5 py-3 text-sm font-black text-white">Kodiak whitepaper</Link>
              </div>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
