#!/usr/bin/env bash
set -euo pipefail

echo "🐻 Starting Kodiak setup..."

# Keep the first milestone simple: a branded web app plus project documentation.
if [ -d "web" ]; then
  echo "The web folder already exists, so I will not overwrite it."
else
  npx create-next-app@latest web \
    --typescript \
    --tailwind \
    --eslint \
    --app \
    --src-dir \
    --use-npm \
    --import-alias "@/*" \
    --yes
fi

cd web

echo "Installing Solana and Raydium libraries..."
npm install \
  @raydium-io/raydium-sdk-v2 \
  @solana/web3.js \
  @solana/spl-token \
  bn.js

cat > .env.example <<'EOF'
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com

# Added after Kodiak's Raydium Platform PDA is created.
NEXT_PUBLIC_KODIAK_PLATFORM_ID=

# Never place a seed phrase or private key in this file.
EOF

cat > src/app/page.tsx <<'EOF'
const feeRows = [
  ["Kodiak platform fee", "0.60%", "Bonding curve only"],
  ["Raydium protocol fee", "0.25%", "Bonding curve only"],
  ["Creator fee", "0.45%", "Bonding curve only; claimable"],
  ["Creator fee after migration", "1.05%", "Optional; creator chooses at launch"],
];

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <section className="mx-auto flex min-h-[70vh] max-w-6xl flex-col justify-center px-6 py-20">
        <div className="mb-6 inline-flex w-fit rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm text-amber-300">
          Built on Solana · Powered by Raydium LaunchLab
        </div>

        <h1 className="max-w-4xl text-5xl font-black tracking-tight sm:text-7xl">
          Launch your memecoin.
          <span className="block text-amber-400">Unleash the Kodiak.</span>
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-400">
          Create a token with no Kodiak launch charge. Trade on a bonding curve,
          graduate to Raydium liquidity, and let creators earn transparent,
          claimable fees.
        </p>

        <div className="mt-10 flex flex-wrap gap-4">
          <button
            type="button"
            className="rounded-xl bg-amber-400 px-6 py-3 font-bold text-zinc-950"
          >
            Create a coin
          </button>
          <button
            type="button"
            className="rounded-xl border border-zinc-700 px-6 py-3 font-bold"
          >
            Explore launches
          </button>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
          <h2 className="text-2xl font-bold">Kodiak fee model</h2>
          <p className="mt-2 text-zinc-400">
            Launchers pay blockchain transaction costs, not a separate Kodiak
            creation charge.
          </p>

          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left">
              <thead className="text-sm text-zinc-500">
                <tr>
                  <th className="border-b border-zinc-800 pb-3">Fee</th>
                  <th className="border-b border-zinc-800 pb-3">Rate</th>
                  <th className="border-b border-zinc-800 pb-3">When</th>
                </tr>
              </thead>
              <tbody>
                {feeRows.map(([name, rate, when]) => (
                  <tr key={name}>
                    <td className="border-b border-zinc-800 py-4 font-medium">
                      {name}
                    </td>
                    <td className="border-b border-zinc-800 py-4 text-amber-300">
                      {rate}
                    </td>
                    <td className="border-b border-zinc-800 py-4 text-zinc-400">
                      {when}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-5 text-sm leading-6 text-zinc-500">
            Estimated blockchain costs must be displayed as estimates rather
            than guaranteed at 0.02 SOL because network and account-creation
            costs can vary.
          </p>
        </div>
      </section>
    </main>
  );
}
EOF

cat > ../README.md <<'EOF'
# Kodiak

Kodiak is a branded Solana memecoin launchpad built on Raydium LaunchLab.

## Product rules

- No separate Kodiak token-creation charge.
- The launcher pays actual Solana transaction and account-creation costs.
- Bonding-curve fee targets:
  - 0.60% Kodiak platform fee
  - 0.25% Raydium protocol fee
  - 0.45% claimable creator fee
- Post-migration creator fee target:
  - 1.05%
  - creator opt-in
- Migration target:
  - Raydium CPMM
- Development starts on devnet.
- Mainnet is prohibited until testing and an independent security review are complete.

## Why Kodiak uses Raydium LaunchLab first

Raydium already supplies the on-chain bonding curve, automatic migration,
platform configuration, fee collection, and SDK. Kodiak provides the brand,
website, launch flow, discovery pages, dashboards, and platform settings.

This is safer and faster than writing a new unaudited bonding-curve program
from scratch.

## Repository

- `web/` — Next.js website
- `docs/` — product and build notes
- `kodiak-bootstrap.sh` — one-time iPhone-friendly setup script

## Run inside Codespaces

```bash
cd web
npm run dev
```

Open the forwarded port when Codespaces offers it.

## Security

Never commit:

- seed phrases
- private keys
- wallet JSON keypair files
- production RPC secrets
- treasury credentials
EOF

mkdir -p ../docs

cat > ../docs/BUILD_PLAN.md <<'EOF'
# Kodiak build plan

## Milestone 1 — Foundation

- Branded Next.js website
- Fee disclosure
- Devnet configuration
- GitHub Codespaces workflow

## Milestone 2 — Wallet and launch form

- Solana wallet connection
- Token name, ticker, image, description, and social links
- Metadata upload
- Cost estimate before wallet signature

## Milestone 3 — Raydium platform

- Create Kodiak Platform PDA on devnet
- Configure platform fee and creator fee behavior
- Store Platform PDA in environment settings
- Verify fee math from on-chain state

## Milestone 4 — LaunchLab trading

- Create token and bonding curve
- Buy and sell
- Slippage protection
- Curve progress and graduation status
- Creator and platform fee claims

## Milestone 5 — Migration

- Automatic Raydium CPMM migration
- Post-migration creator fee opt-in
- Fee Key handling
- Raydium/Jupiter trading links

## Milestone 6 — Safety

- Clear authority and fee disclosures
- Transaction simulation
- Rate limiting
- Error reporting
- Devnet test suite
- Independent smart-contract/integration review

## Milestone 7 — Mainnet

- Production RPC
- Treasury multisig
- Monitoring and alerts
- Terms, privacy, risk disclosures, and legal review
- Limited beta before public launch
EOF

cat > ../docs/DECISIONS.md <<'EOF'
# Locked product decisions

1. Name: Kodiak
2. Chain: Solana
3. Launch system: Raydium LaunchLab
4. Migration pool: Raydium CPMM
5. Kodiak creation charge: 0 SOL
6. User still pays actual blockchain costs
7. Curve platform fee target: 0.60%
8. Curve Raydium protocol fee target: 0.25%
9. Curve creator fee target: 0.45%, claimable
10. Post-migration creator fee target: 1.05%, creator opt-in
11. Initial network: devnet
12. No mainnet launch before security review

## Important wording

Do not advertise a guaranteed `0.02 SOL` blockchain cost. Display an estimate
and show the wallet's actual transaction simulation before signing.

Do not describe a charge as paid to Raydium unless the current Raydium
configuration and on-chain transaction actually route that amount to Raydium.
EOF

npm run lint
npm run build

cd ..

echo ""
echo "✅ Kodiak milestone 1 is ready."
echo "Next command: cd web && npm run dev"
