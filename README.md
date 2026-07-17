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
