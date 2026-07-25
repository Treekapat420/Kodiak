#!/usr/bin/env bash
set -euo pipefail

FILE="web/src/components/creator/ClaimCreatorRewards.tsx"

cp "$FILE" "$FILE.bak-claimed-amount"

python3 - <<'PY'
from pathlib import Path
import re

path = Path("web/src/components/creator/ClaimCreatorRewards.tsx")
s = path.read_text()

s = s.replace(
    'import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";',
    'import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";',
    1,
)

needle = '    const { execute } = await raydium.launchpad.claimCreatorFee({'
if 'beforeClaimBalance' not in s:
    s = s.replace(
        needle,
        '''    const creatorWrappedSolAta = getAssociatedTokenAddressSync(
      NATIVE_MINT,
      publicKey,
    );

    const beforeClaimBalance = await connection
      .getTokenAccountBalance(creatorWrappedSolAta, "confirmed")
      .then((response) => BigInt(response.value.amount))
      .catch(() => 0n);

    const { execute } = await raydium.launchpad.claimCreatorFee({''',
        1,
    )

old = '''    const result = await execute({ sendAndConfirm: true });
    const signature = signatureFrom(result);

    setStatus({
      kind: "success",
      message:
        "Raydium confirmed the creator-fee claim on Devnet.",
      signature,
    });'''

new = '''    const result = await execute({ sendAndConfirm: true });
    const signature = signatureFrom(result);

    let afterClaimBalance = beforeClaimBalance;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      afterClaimBalance = await connection
        .getTokenAccountBalance(creatorWrappedSolAta, "confirmed")
        .then((response) => BigInt(response.value.amount))
        .catch(() => beforeClaimBalance);

      if (afterClaimBalance > beforeClaimBalance) break;
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }

    const claimedLamports =
      afterClaimBalance > beforeClaimBalance
        ? afterClaimBalance - beforeClaimBalance
        : 0n;
    const claimedSol = Number(claimedLamports) / 1_000_000_000;

    setStatus({
      kind: "success",
      message:
        claimedLamports > 0n
          ? `${claimedSol.toFixed(9).replace(/0+$/, "").replace(/\.$/, "")} SOL claimed successfully on Devnet.`
          : "Raydium confirmed the creator-fee claim on Devnet.",
      signature,
    });'''

if old not in s:
    raise SystemExit("Could not find the current success block. No changes written.")

s = s.replace(old, new, 1)
path.write_text(s)
print("Patched ClaimCreatorRewards.tsx")
PY

cd web
npm run lint
npm run build
cd ..

git add web/src/components/creator/ClaimCreatorRewards.tsx
git commit -m "show actual creator reward claimed amount" || true
git push

echo
echo "✅ Installed and pushed."
