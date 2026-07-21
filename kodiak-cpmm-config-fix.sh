#!/usr/bin/env bash
set -euo pipefail

echo "🐻 Fixing Raydium Devnet CPMM configuration parsing..."

if [ ! -d "web" ]; then
  echo "Error: run this from /workspaces/Kodiak."
  exit 1
fi

mkdir -p web/src/app/api/raydium/devnet-cpmm-config

cat > web/src/app/api/raydium/devnet-cpmm-config/route.ts <<'EOF'
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function isPublicKey(value: unknown): value is string {
  if (typeof value !== "string") return false;

  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

function collectPublicKeyConfigs(value: unknown, output: Set<string>) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectPublicKeyConfigs(item, output));
    return;
  }

  if (!isRecord(value)) return;

  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    const isConfigField =
      normalizedKey === "id" ||
      normalizedKey === "configid" ||
      normalizedKey === "config_id" ||
      normalizedKey === "pubkey" ||
      normalizedKey === "address";

    if (isConfigField && isPublicKey(item)) {
      output.add(item);
      continue;
    }

    if (Array.isArray(item) || isRecord(item)) {
      collectPublicKeyConfigs(item, output);
    }
  }
}

export async function GET() {
  try {
    const response = await fetch(
      "https://api-v3-devnet.raydium.io/main/cpmm-config",
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
      },
    );

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `Raydium returned HTTP ${response.status}`,
          configIds: [],
        },
        { status: 502 },
      );
    }

    const payload: unknown = await response.json();
    const configIds = new Set<string>();
    collectPublicKeyConfigs(payload, configIds);

    if (configIds.size === 0) {
      return NextResponse.json(
        {
          error:
            "Raydium's Devnet API did not return a valid CPMM configuration public key.",
          configIds: [],
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      configIds: Array.from(configIds),
      source: "Raydium Devnet CPMM config API",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to fetch CPMM configurations.",
        configIds: [],
      },
      { status: 500 },
    );
  }
}
EOF

python - <<'PY'
from pathlib import Path

path = Path("web/src/app/platform-setup/page.tsx")
text = path.read_text()

old = '''  const canCreate =
    connected &&
    Boolean(publicKey) &&
    Boolean(signAllTransactions) &&
    confirmed &&
    Boolean(cpConfigId) &&
    status.kind !== "working";
'''

new = '''  let cpConfigIsValid = false;

  try {
    cpConfigIsValid =
      new PublicKey(cpConfigId).toBase58() === cpConfigId;
  } catch {
    cpConfigIsValid = false;
  }

  const canCreate =
    connected &&
    Boolean(publicKey) &&
    Boolean(signAllTransactions) &&
    confirmed &&
    cpConfigIsValid &&
    status.kind !== "working";
'''

if old not in text:
    raise SystemExit("Could not find the existing canCreate block.")

text = text.replace(old, new)

old = '''    try {
      const raydium = await loadDevnetRaydium({
'''

new = '''    try {
      let cpConfig: PublicKey;

      try {
        cpConfig = new PublicKey(cpConfigId);
      } catch {
        throw new Error(
          "The selected CPMM configuration is not a valid Solana public key.",
        );
      }

      const raydium = await loadDevnetRaydium({
'''

if old not in text:
    raise SystemExit("Could not find the transaction setup block.")

text = text.replace(old, new)

old = '''          cpConfigId: new PublicKey(cpConfigId),
'''
new = '''          cpConfigId: cpConfig,
'''

if old not in text:
    raise SystemExit("Could not find the cpConfigId assignment.")

text = text.replace(old, new)

old = '''                )}
              </label>

              <label className="flex items-start gap-3 rounded-2xl'''
new = '''                )}

                {cpConfigId && !cpConfigIsValid && (
                  <p className="mt-2 text-sm font-bold text-red-300">
                    This is not a valid Solana CPMM configuration address.
                  </p>
                )}
              </label>

              <label className="flex items-start gap-3 rounded-2xl'''

if old not in text:
    raise SystemExit("Could not find the CPMM field ending.")

text = text.replace(old, new)
path.write_text(text)
PY

cd web
npm run lint
npm run build
cd ..

git add web/src/app/api/raydium/devnet-cpmm-config/route.ts web/src/app/platform-setup/page.tsx
git commit -m "fix Devnet CPMM config public key parsing" || true

echo ""
echo "✅ CPMM configuration parser fixed."
echo "Keep npm run dev running, refresh the platform setup page, and retry."
