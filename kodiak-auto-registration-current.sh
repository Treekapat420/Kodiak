#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/Kodiak"
WEB="$ROOT/web"
LAUNCH="$WEB/src/app/launch/page.tsx"

echo "🐻 Wiring automatic Creator Dashboard registration into the current launch flow..."

if [ ! -f "$LAUNCH" ]; then
  echo "Error: $LAUNCH was not found."
  exit 1
fi

python - <<'PY'
from pathlib import Path

path = Path("/workspaces/Kodiak/web/src/app/launch/page.tsx")
text = path.read_text()

old = '''      setLaunchStatus({
        kind: "success",
        message: "Token created through Kodiak on Solana Devnet.",
        mint,
        signatures: uniqueSignatures,
      });'''

new = '''      const launchSignature = uniqueSignatures[0];

      if (!launchSignature) {
        throw new Error(
          "The token was created, but Kodiak could not capture the launch transaction signature. Check Solana Explorer before retrying.",
        );
      }

      setLaunchStatus({
        kind: "working",
        message: "Registering the verified launch in the Creator Dashboard…",
      });

      const registrationResponse = await fetch(
        "/api/creator/launches",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            mint,
            creator: publicKey.toBase58(),
            name: form.name,
            symbol: form.symbol,
            signature: launchSignature,
            createdAt: new Date().toISOString(),
          }),
        },
      );

      const registrationPayload =
        (await registrationResponse.json()) as {
          launch?: { mint: string };
          error?: string;
        };

      if (!registrationResponse.ok || !registrationPayload.launch) {
        throw new Error(
          registrationPayload.error ||
            "The token launched, but Creator Dashboard registration failed.",
        );
      }

      setLaunchStatus({
        kind: "success",
        message:
          "Token created and automatically added to the Creator Dashboard.",
        mint,
        signatures: uniqueSignatures,
      });'''

if old not in text:
    raise SystemExit(
        "The current success block was not found. No files were changed."
    )

path.write_text(text.replace(old, new, 1))
PY

cd "$WEB"

echo "Running lint..."
npm run lint

echo "Running production build..."
npm run build

cd "$ROOT"

git add web/src/app/launch/page.tsx
git commit -m "register successful launches in creator dashboard" || true
git push origin main

echo ""
echo "✅ Automatic Creator Dashboard registration installed and pushed."
echo ""
echo "After Vercel shows Ready, create a fresh Devnet test token."
echo "When the launch succeeds, Kodiak will verify and register it automatically."
echo "Then open /creator with the same wallet and press Refresh Dashboard."
