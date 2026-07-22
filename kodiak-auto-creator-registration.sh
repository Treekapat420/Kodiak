#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/Kodiak"
WEB="$ROOT/web"
LAUNCH="$WEB/src/app/launch/page.tsx"
CREATOR="$WEB/src/app/creator/page.tsx"

echo "🐻 Installing automatic creator launch registration..."

if [ ! -f "$LAUNCH" ]; then
  echo "Error: $LAUNCH was not found."
  exit 1
fi

python - <<'PY'
from pathlib import Path

launch = Path("/workspaces/Kodiak/web/src/app/launch/page.tsx")
text = launch.read_text()

old = '''      const mint = mintKeypair.publicKey.toBase58();
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

      setLaunchStatus({
        kind: "success",
        message: "Token created through Kodiak on Solana Devnet.",
        mint,
        signatures: uniqueSignatures,
      });'''

new = '''      const mint = mintKeypair.publicKey.toBase58();
      const launchSignature = uniqueSignatures[0];
      const createdAt = new Date().toISOString();

      if (!launchSignature) {
        throw new Error(
          "The token was created, but Kodiak could not capture the launch transaction signature. Check Solana Explorer before retrying.",
        );
      }

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
      );

      setLaunchStatus({
        kind: "working",
        message: "Registering the verified launch in the Creator Dashboard…",
      });

      const registrationResponse = await fetch("/api/creator/launches", {
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
          createdAt,
        }),
      });

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
        "The expected launch success block was not found. No files were changed."
    )

launch.write_text(text.replace(old, new))
PY

python - <<'PY'
from pathlib import Path

creator = Path("/workspaces/Kodiak/web/src/app/creator/page.tsx")
if not creator.exists():
    raise SystemExit("Creator Dashboard page was not found.")

text = creator.read_text()

text = text.replace(
    "Connect the creator wallet, then load or sync its Kodiak launches.",
    "Connect the creator wallet, then refresh its automatically registered Kodiak launches.",
)

old_buttons = '''            <button
              type="button"
              onClick={() => void syncLastLaunch()}
              disabled={!connected || status.kind === "working"}
              className="rounded-2xl bg-gradient-to-r from-emerald-400 to-amber-300 px-5 py-4 font-black text-black disabled:opacity-40"
            >
              Sync Last Kodiak Launch
            </button>
            <button
              type="button"
              onClick={() => void loadDashboard()}
              disabled={!connected || status.kind === "working"}
              className="rounded-2xl border border-white/10 px-5 py-4 font-black disabled:opacity-40"
            >
              Refresh Dashboard
            </button>'''

new_buttons = '''            <button
              type="button"
              onClick={() => void loadDashboard()}
              disabled={!connected || status.kind === "working"}
              className="rounded-2xl bg-gradient-to-r from-emerald-400 to-amber-300 px-5 py-4 font-black text-black disabled:opacity-40"
            >
              Refresh Dashboard
            </button>
            <button
              type="button"
              onClick={() => void syncLastLaunch()}
              disabled={!connected || status.kind === "working"}
              className="rounded-2xl border border-white/10 px-5 py-4 font-black disabled:opacity-40"
            >
              Recover Older Browser Launch
            </button>'''

if old_buttons not in text:
    raise SystemExit("The Creator Dashboard button block was not found.")

creator.write_text(text.replace(old_buttons, new_buttons))
PY

cd "$WEB"

echo "Running lint..."
npm run lint

echo "Running production build..."
npm run build

cd "$ROOT"

git add web/src/app/launch/page.tsx web/src/app/creator/page.tsx
git commit -m "automatically register launches in creator dashboard" || true
git push origin main

echo ""
echo "✅ Automatic creator registration installed and pushed."
echo ""
echo "New launches will register in Redis immediately after on-chain success."
echo "Creators can then open /creator and press Refresh Dashboard."
echo ""
echo "TEST1 predates this change. The recovery button may work only if its"
echo "original browser still contains both the mint and launch signature."
