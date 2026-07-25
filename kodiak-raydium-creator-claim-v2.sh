#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/Kodiak"
WEB="$ROOT/web"
DASH="$WEB/src/app/dashboard/page.tsx"
CLAIM="$WEB/src/components/creator/ClaimCreatorRewards.tsx"
LAYOUT="$WEB/src/app/layout.tsx"
PLATFORM="$WEB/src/app/platform-setup/page.tsx"

echo "🐻 Installing Kodiak Raydium creator claims v2..."

for file in "$DASH" "$LAYOUT" "$PLATFORM"; do
  if [ ! -f "$file" ]; then
    echo "Missing required file: $file"
    exit 1
  fi
done

mkdir -p "$(dirname "$CLAIM")"

cp "$DASH" "$DASH.bak-raydium-claim-v2"
cp "$LAYOUT" "$LAYOUT.bak-kodiak-metadata-v2"
cp "$PLATFORM" "$PLATFORM.bak-platform-fee-v2"

cat > "$CLAIM" <<'TS'
"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { TxVersion } from "@raydium-io/raydium-sdk-v2";
import { useState } from "react";
import {
  DEVNET_LAUNCHPAD_PROGRAM_ID,
  loadDevnetRaydium,
} from "@/lib/raydium/devnet";

type Status =
  | { kind: "idle"; message: string }
  | { kind: "working"; message: string }
  | { kind: "success"; message: string; signature?: string }
  | { kind: "error"; message: string };

function signatureFrom(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 20) return value;
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;

  for (const key of ["signature", "txId", "txid", "id"]) {
    const v = record[key];
    if (typeof v === "string" && v.length > 20) return v;
  }

  if (Array.isArray(record.txIds)) {
    const v = record.txIds.find(
      (item) => typeof item === "string" && item.length > 20,
    );
    if (typeof v === "string") return v;
  }

  return undefined;
}

export function ClaimCreatorRewards() {
  const { connection } = useConnection();
  const { connected, publicKey, signAllTransactions } = useWallet();

  const [status, setStatus] = useState<Status>({
    kind: "idle",
    message:
      "Claims use Raydium LaunchLab's real creator-fee vault on Solana Devnet.",
  });

  async function claim() {
    if (!connected || !publicKey || !signAllTransactions) {
      setStatus({
        kind: "error",
        message: "Connect Phantom in Devnet mode first.",
      });
      return;
    }

    try {
      setStatus({
        kind: "working",
        message: "Building the Raydium creator-fee claim…",
      });

      const raydium = await loadDevnetRaydium({
        connection,
        owner: publicKey,
        signAllTransactions,
      });

      const { execute } = await raydium.launchpad.claimCreatorFee({
        programId: DEVNET_LAUNCHPAD_PROGRAM_ID,
        mintB: NATIVE_MINT,
        mintBProgram: TOKEN_PROGRAM_ID,
        txVersion: TxVersion.V0,
        feePayer: publicKey,
      });

      setStatus({
        kind: "working",
        message: "Approve the Devnet creator-fee claim in Phantom…",
      });

      const result = await execute({ sendAndConfirm: true });
      const signature = signatureFrom(result);

      setStatus({
        kind: "success",
        message:
          "Raydium confirmed the creator-fee claim on Devnet.",
        signature,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The creator-fee claim failed.",
      });
    }
  }

  const busy = status.kind === "working";

  return (
    <section className="mt-6 rounded-[2rem] border border-emerald-400/20 bg-emerald-400/[0.04] p-5 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
            On-chain rewards
          </p>
          <h2 className="mt-2 text-2xl font-black">Claim Creator Rewards</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
            Kodiak asks Raydium LaunchLab to release creator fees held for the
            connected creator wallet. The Redis ledger below remains an
            analytics and audit record only.
          </p>
        </div>

        <button
          type="button"
          disabled={!connected || busy}
          onClick={() => void claim()}
          className="shrink-0 rounded-xl bg-emerald-400 px-5 py-3 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Claiming…" : "Claim on Devnet"}
        </button>
      </div>

      <div
        className={`mt-5 rounded-2xl border p-4 text-sm ${
          status.kind === "error"
            ? "border-rose-400/20 bg-rose-400/[0.05] text-rose-200"
            : status.kind === "success"
              ? "border-emerald-400/20 bg-emerald-400/[0.05] text-emerald-200"
              : "border-white/10 bg-black/20 text-zinc-500"
        }`}
      >
        <p className="font-bold">{status.message}</p>

        {status.kind === "success" && status.signature ? (
          <a
            href={`https://explorer.solana.com/tx/${status.signature}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block break-all text-xs font-black text-emerald-300 underline underline-offset-4"
          >
            View Devnet transaction
          </a>
        ) : null}
      </div>

      <p className="mt-4 text-xs leading-5 text-zinc-600">
        The tracked creator amount on this page is an estimate from Kodiak&apos;s
        recorded trades. Raydium&apos;s on-chain vault is the authority for what
        can actually be claimed.
      </p>
    </section>
  );
}
TS

python3 - <<'PY'
from pathlib import Path
import re

dash = Path("/workspaces/Kodiak/web/src/app/dashboard/page.tsx")
text = dash.read_text()

# Insert import idempotently.
claim_import = 'import { ClaimCreatorRewards } from "@/components/creator/ClaimCreatorRewards";'
if claim_import not in text:
    lines = text.splitlines()
    import_positions = [i for i, line in enumerate(lines) if line.startswith("import ")]
    if not import_positions:
        raise SystemExit("Could not find dashboard imports.")
    lines.insert(max(import_positions) + 1, claim_import)
    text = "\n".join(lines) + ("\n" if text.endswith("\n") else "")

# Insert the claim panel immediately BEFORE the current revenue/economics grid.
if "<ClaimCreatorRewards />" not in text:
    markers = [
        '<section className="mt-6 grid gap-6 lg:grid-cols-2">',
        '<section className="mt-6 grid gap-6 lg:grid-cols-[1fr_.9fr]">',
    ]
    found = None
    for marker in markers:
        if marker in text:
            found = marker
            break

    if not found:
        # Fallback: anchor to the revenue card itself.
        revenue = '<Card title="Fee ledger totals" eyebrow="Revenue accounting">'
        idx = text.find(revenue)
        if idx == -1:
            raise SystemExit("Could not find the current dashboard revenue section.")
        section_idx = text.rfind("<section", 0, idx)
        if section_idx == -1:
            raise SystemExit("Could not locate the revenue section start.")
        text = (
            text[:section_idx]
            + '        <ClaimCreatorRewards />\n\n'
            + text[section_idx:]
        )
    else:
        text = text.replace(
            found,
            '        <ClaimCreatorRewards />\n\n        ' + found,
            1,
        )

# Update wording so Redis is not presented as claimable on-chain balance.
text = text.replace('label="Creator accrued"', 'label="Creator tracked"')
text = text.replace(
    '<p className="font-black text-amber-200">Accrued accounting — not claimable SOL yet.</p>',
    '<p className="font-black text-amber-200">Kodiak audit ledger — separate from Raydium&apos;s on-chain vault.</p>',
)
text = text.replace(
    "The ledger records what would accrue under Kodiak&apos;s current Devnet fee model. "
    "On-chain fee transfer, escrow, and claims still need to be implemented before mainnet.",
    "The ledger records Kodiak&apos;s trade-based estimate. The claim panel above uses "
    "Raydium LaunchLab&apos;s real on-chain creator-fee vault.",
)

dash.write_text(text)

layout = Path("/workspaces/Kodiak/web/src/app/layout.tsx")
layout_text = layout.read_text()
layout_text = re.sub(
    r'title:\s*["\']Create Next App["\']',
    'title: "Kodiak | Solana Launchpad"',
    layout_text,
)
layout_text = re.sub(
    r'description:\s*["\']Generated by create next app["\']',
    'description: "Kodiak — a creator-first Solana token launchpad powered by Raydium LaunchLab."',
    layout_text,
)
layout.write_text(layout_text)

platform = Path("/workspaces/Kodiak/web/src/app/platform-setup/page.tsx")
platform_text = platform.read_text()

if "const PLATFORM_FEE_RATE = 6_000;" in platform_text:
    platform_text = platform_text.replace(
        "const PLATFORM_FEE_RATE = 6_000;",
        "const PLATFORM_FEE_RATE = 5_000;",
        1,
    )
elif "const PLATFORM_FEE_RATE = 5_000;" not in platform_text:
    raise SystemExit("Could not safely locate PLATFORM_FEE_RATE.")

platform.write_text(platform_text)
PY

cd "$WEB"

echo ""
echo "Running lint..."
npm run lint

echo ""
echo "Running production build..."
npm run build

cd "$ROOT"

git add \
  web/src/components/creator/ClaimCreatorRewards.tsx \
  web/src/app/dashboard/page.tsx \
  web/src/app/layout.tsx \
  web/src/app/platform-setup/page.tsx

git commit -m "add Raydium creator fee claims on devnet" || true
git push origin main

echo ""
echo "✅ Raydium creator claim UI installed."
echo "✅ Dashboard now separates tracked rewards from on-chain claims."
echo "✅ Browser metadata updated to Kodiak."
echo "✅ Future PlatformConfig creation targets a 0.50% Kodiak platform fee."
echo "✅ Changes pushed to main."
echo ""
echo "IMPORTANT:"
echo "The existing on-chain PlatformConfig is NOT changed by editing the constant."
echo "Do not press Claim yet. Verify the deployment first."
