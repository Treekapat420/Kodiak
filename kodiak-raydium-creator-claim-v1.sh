#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/Kodiak"
WEB="$ROOT/web"
DASH="$WEB/src/app/dashboard/page.tsx"
CLAIM="$WEB/src/components/creator/ClaimCreatorRewards.tsx"
LAYOUT="$WEB/src/app/layout.tsx"
PLATFORM="$WEB/src/app/platform-setup/page.tsx"

echo "🐻 Installing Raydium on-chain creator claims..."

for file in "$DASH" "$LAYOUT" "$PLATFORM"; do
  if [ ! -f "$file" ]; then
    echo "Missing required file: $file"
    exit 1
  fi
done

mkdir -p "$(dirname "$CLAIM")"

cp "$DASH" "$DASH.bak-raydium-claim"
cp "$LAYOUT" "$LAYOUT.bak-kodiak-metadata"
cp "$PLATFORM" "$PLATFORM.bak-platform-fee-5000"

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

type ClaimStatus =
  | { kind: "idle"; message: string }
  | { kind: "working"; message: string }
  | { kind: "success"; message: string; signature?: string }
  | { kind: "error"; message: string };

function extractSignature(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 20) return value;
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ["signature", "txId", "txid", "id"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.length > 20) return candidate;
  }

  if (Array.isArray(record.txIds)) {
    const first = record.txIds.find(
      (item) => typeof item === "string" && item.length > 20,
    );
    if (typeof first === "string") return first;
  }

  return undefined;
}

export function ClaimCreatorRewards() {
  const { connection } = useConnection();
  const { publicKey, connected, signAllTransactions } = useWallet();

  const [status, setStatus] = useState<ClaimStatus>({
    kind: "idle",
    message:
      "Claims use Raydium LaunchLab's on-chain creator-fee vault on Devnet.",
  });

  const claim = async () => {
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
        message: "Building the Raydium creator-fee claim transaction…",
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
        message: "Approve the creator-fee claim in Phantom…",
      });

      const result = await execute({ sendAndConfirm: true });
      const signature = extractSignature(result);

      setStatus({
        kind: "success",
        message:
          "Raydium confirmed the creator-fee claim on Devnet. Kodiak's ledger remains a lifetime audit record.",
        signature,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The Raydium creator-fee claim failed.",
      });
    }
  };

  const busy = status.kind === "working";

  return (
    <div className="rounded-[2rem] border border-emerald-400/20 bg-emerald-400/[0.04] p-5 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
            On-chain rewards
          </p>
          <h2 className="mt-2 text-2xl font-black">Claim Creator Rewards</h2>
          <p className="mt-3 text-sm leading-6 text-zinc-500">
            This asks Raydium LaunchLab to release creator fees held for the
            connected creator wallet in its Devnet creator-fee vault.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void claim()}
          disabled={busy || !connected}
          className="shrink-0 rounded-xl bg-emerald-400 px-5 py-3 text-sm font-black text-black transition disabled:cursor-not-allowed disabled:opacity-40"
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
        The tracked creator amount elsewhere on this page is Kodiak&apos;s
        trade-based audit estimate. Raydium&apos;s on-chain vault determines
        what can actually be withdrawn.
      </p>
    </div>
  );
}
TS

python3 - <<'PY'
from pathlib import Path
import re

dash = Path("/workspaces/Kodiak/web/src/app/dashboard/page.tsx")
text = dash.read_text()

import_line = 'import { ClaimCreatorRewards } from "@/components/creator/ClaimCreatorRewards";'
if import_line not in text:
    lines = text.splitlines()
    insert_at = max(i + 1 for i, line in enumerate(lines) if line.startswith("import "))
    lines.insert(insert_at, import_line)
    text = "\n".join(lines) + ("\n" if text.endswith("\n") else "")

if "<ClaimCreatorRewards />" not in text:
    marker = '<section className="mt-6 grid gap-6 lg:grid-cols-[1fr_.9fr]">'
    if marker not in text:
        raise SystemExit("Could not find dashboard revenue section marker.")
    text = text.replace(
        marker,
        '<section className="mt-6">\n          <ClaimCreatorRewards />\n        </section>\n\n        ' + marker,
        1,
    )

text = text.replace('label="Accrued creator rewards"', 'label="Tracked creator rewards"')
text = text.replace(
    'Accounting only — not yet claimable on-chain.',
    'Kodiak audit ledger — separate from the Raydium on-chain vault.',
)

dash.write_text(text)

layout = Path("/workspaces/Kodiak/web/src/app/layout.tsx")
text = layout.read_text()
text = re.sub(r'title:\s*["\']Create Next App["\']', 'title: "Kodiak | Solana Launchpad"', text)
text = re.sub(
    r'description:\s*["\']Generated by create next app["\']',
    'description: "Kodiak — a creator-first Solana token launchpad powered by Raydium LaunchLab."',
    text,
)
layout.write_text(text)

platform = Path("/workspaces/Kodiak/web/src/app/platform-setup/page.tsx")
text = platform.read_text()
if "const PLATFORM_FEE_RATE = 6_000;" in text:
    text = text.replace("const PLATFORM_FEE_RATE = 6_000;", "const PLATFORM_FEE_RATE = 5_000;", 1)
elif "const PLATFORM_FEE_RATE = 5_000;" not in text:
    raise SystemExit("Could not safely locate PLATFORM_FEE_RATE.")
platform.write_text(text)
PY

cd "$WEB"
echo "Running lint..."
npm run lint

echo "Running production build..."
npm run build

cd "$ROOT"
git add   web/src/components/creator/ClaimCreatorRewards.tsx   web/src/app/dashboard/page.tsx   web/src/app/layout.tsx   web/src/app/platform-setup/page.tsx

git commit -m "add Raydium creator fee claims on devnet" || true
git push origin main

echo ""
echo "✅ Raydium creator claim UI installed and pushed."
echo "✅ Kodiak browser title updated."
echo "✅ NEW PlatformConfig creation now targets 0.50% Kodiak platform fee."
echo ""
echo "IMPORTANT: an already-created on-chain PlatformConfig is NOT changed by"
echo "editing the constant. It remains at its current on-chain rate until the"
echo "platform admin explicitly updates that account."
