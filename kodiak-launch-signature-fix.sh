#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/Kodiak"
WEB="$ROOT/web"
LAUNCH="$WEB/src/app/launch/page.tsx"

echo "🐻 Fixing Kodiak launch-signature capture..."

if [ ! -f "$LAUNCH" ]; then
  echo "Error: $LAUNCH was not found."
  exit 1
fi

python - <<'PY'
from pathlib import Path

path = Path("/workspaces/Kodiak/web/src/app/launch/page.tsx")
text = path.read_text()

old = '''      collectSignatures(sent);
      const mint = mintKeypair.publicKey.toBase58();
      const uniqueSignatures = Array.from(new Set(signatures));

      window.localStorage.setItem(
        "kodiak-last-devnet-launch",
        JSON.stringify({
          mint,
          signatures: uniqueSignatures,
          name: form.name,
          symbol: form.symbol,
          createdAt: new Date().toISOString(),
        }),
      );

      const launchSignature = uniqueSignatures[0];

      if (!launchSignature) {
        throw new Error(
          "The token was created, but Kodiak could not capture the launch transaction signature. Check Solana Explorer before retrying.",
        );
      }'''

new = '''      collectSignatures(sent);
      const mint = mintKeypair.publicKey.toBase58();

      const looksLikeSolanaSignature = (value: string) =>
        /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(value);

      let uniqueSignatures = Array.from(new Set(signatures)).filter(
        looksLikeSolanaSignature,
      );

      if (uniqueSignatures.length === 0) {
        setLaunchStatus({
          kind: "working",
          message: "Locating the confirmed launch transaction on Devnet…",
        });

        for (let attempt = 0; attempt < 8; attempt += 1) {
          const onChainSignatures =
            await connection.getSignaturesForAddress(
              mintKeypair.publicKey,
              { limit: 10 },
              "confirmed",
            );

          uniqueSignatures = onChainSignatures
            .filter((entry) => entry.err === null)
            .map((entry) => entry.signature)
            .filter(looksLikeSolanaSignature);

          if (uniqueSignatures.length > 0) break;

          await new Promise((resolve) =>
            window.setTimeout(resolve, 1200),
          );
        }
      }

      const launchSignature = uniqueSignatures[0];

      if (!launchSignature) {
        throw new Error(
          "The token was created, but Kodiak could not locate its confirmed launch transaction. Do not launch again; check the mint on Solana Explorer.",
        );
      }

      const createdAt = new Date().toISOString();

      window.localStorage.setItem(
        "kodiak-last-devnet-launch",
        JSON.stringify({
          mint,
          signatures: uniqueSignatures,
          name: form.name,
          symbol: form.symbol,
          creator: publicKey.toBase58(),
          createdAt,
        }),
      );'''

if old not in text:
    raise SystemExit(
        "The expected signature block was not found. No files were changed."
    )

text = text.replace(old, new, 1)
text = text.replace(
    '            createdAt: new Date().toISOString(),',
    '            createdAt,',
    1,
)

path.write_text(text)
PY

cd "$WEB"

echo "Running lint..."
npm run lint

echo "Running production build..."
npm run build

cd "$ROOT"

git add web/src/app/launch/page.tsx
git commit -m "reliably capture confirmed launch transaction signature" || true
git push origin main

echo ""
echo "✅ Signature capture fix installed and pushed."
echo ""
echo "This fix:"
echo "- rejects non-signature strings returned by the Raydium SDK"
echo "- falls back to finding the confirmed transaction through the new mint"
echo "- retries briefly while Devnet indexes the transaction"
echo "- registers the creator launch only after a valid signature is found"
