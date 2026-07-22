#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/Kodiak"
WEB="$ROOT/web"

echo "🐻 Rebuilding the Kodiak Creator Dashboard backend..."

if [ ! -f "$WEB/package.json" ]; then
  echo "Error: Kodiak web/package.json was not found."
  exit 1
fi

if [ ! -f "$WEB/src/app/creator/page.tsx" ]; then
  echo "Error: Creator Dashboard page was not found."
  echo "Run the original creator-dashboard installer first."
  exit 1
fi

mkdir -p \
  "$WEB/src/lib/server" \
  "$WEB/src/app/api/config" \
  "$WEB/src/app/api/creator/launches"

cat > "$WEB/src/lib/server/redis.ts" <<'EOF'
import "server-only";
import { Redis } from "@upstash/redis";

let client: Redis | undefined;

export function getRedis(): Redis {
  if (client) return client;

  const url = process.env.KV_REST_API_URL?.trim();
  const token = process.env.KV_REST_API_TOKEN?.trim();

  if (!url || !token) {
    throw new Error(
      "Kodiak database is unavailable in this environment. " +
        "KV_REST_API_URL and KV_REST_API_TOKEN must be configured at runtime.",
    );
  }

  client = new Redis({ url, token });
  return client;
}
EOF

cat > "$WEB/src/app/api/config/route.ts" <<'EOF'
import { NextResponse } from "next/server";
import { getRedis } from "@/lib/server/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIG_KEY = "kodiak:config:v1";

const defaultConfig = {
  version: 1,
  network: "devnet",
  tradingFeeBps: 120,
  infrastructureFeeBps: 25,
  regularCreatorFeeBps: 45,
  regularKodiakFeeBps: 50,
  foundingCreatorFeeBps: 50,
  foundingKodiakFeeBps: 45,
  foundingCreatorLimit: 100,
  creatorSuccessFundPercentOfKodiakRevenue: 5,
  foundingProgramEnabled: true,
  maintenanceMode: false,
};

export async function GET() {
  try {
    const redis = getRedis();
    const stored = await redis.get<Record<string, unknown>>(CONFIG_KEY);

    if (!stored) {
      await redis.set(CONFIG_KEY, defaultConfig);
      return NextResponse.json(defaultConfig);
    }

    return NextResponse.json({
      ...defaultConfig,
      ...stored,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load Kodiak configuration.",
      },
      { status: 503 },
    );
  }
}
EOF

cat > "$WEB/src/app/api/creator/launches/route.ts" <<'EOF'
import { NextRequest, NextResponse } from "next/server";
import {
  clusterApiUrl,
  Connection,
  PublicKey,
} from "@solana/web3.js";
import { getRedis } from "@/lib/server/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LaunchRecord = {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  signature: string;
  network: "devnet";
  createdAt: string;
  verifiedAt: string;
};

function getConnection() {
  return new Connection(
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
      clusterApiUrl("devnet"),
    "confirmed",
  );
}

function launchesKey(creator: string) {
  return `kodiak:creator:${creator}:launches`;
}

function launchKey(mint: string) {
  return `kodiak:launch:${mint}`;
}

function parsePublicKey(value: string) {
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const creatorValue =
      request.nextUrl.searchParams.get("creator")?.trim() ?? "";
    const creator = parsePublicKey(creatorValue);

    if (!creator) {
      return NextResponse.json(
        { error: "A valid creator wallet is required." },
        { status: 400 },
      );
    }

    const redis = getRedis();
    const creatorAddress = creator.toBase58();
    const mints = await redis.lrange<string>(
      launchesKey(creatorAddress),
      0,
      99,
    );

    const records = await Promise.all(
      mints.map((mint) =>
        redis.get<LaunchRecord>(launchKey(mint)),
      ),
    );

    const launches = records.filter(
      (record): record is LaunchRecord => record !== null,
    );

    return NextResponse.json({ launches });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load creator launches.",
      },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      mint?: string;
      creator?: string;
      name?: string;
      symbol?: string;
      signature?: string;
      createdAt?: string;
    };

    const mint = parsePublicKey(body.mint?.trim() ?? "");
    const creator = parsePublicKey(body.creator?.trim() ?? "");
    const signature = body.signature?.trim() ?? "";

    if (!mint || !creator || signature.length < 64) {
      return NextResponse.json(
        {
          error:
            "Mint, creator wallet, and launch transaction signature are required.",
        },
        { status: 400 },
      );
    }

    const connection = getConnection();
    const mintAccount = await connection.getAccountInfo(
      mint,
      "confirmed",
    );

    if (!mintAccount) {
      return NextResponse.json(
        { error: "The token mint was not found on Solana Devnet." },
        { status: 404 },
      );
    }

    const transaction = await connection.getParsedTransaction(
      signature,
      {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      },
    );

    if (!transaction || transaction.meta?.err) {
      return NextResponse.json(
        { error: "The launch transaction was not found or failed." },
        { status: 400 },
      );
    }

    const accountKeys = transaction.transaction.message.accountKeys;
    const signer = accountKeys.find((entry) => entry.signer)?.pubkey;
    const containsMint = accountKeys.some((entry) =>
      entry.pubkey.equals(mint),
    );

    if (!signer?.equals(creator) || !containsMint) {
      return NextResponse.json(
        {
          error:
            "The connected wallet could not be verified as the creator of this launch.",
        },
        { status: 403 },
      );
    }

    const redis = getRedis();
    const creatorAddress = creator.toBase58();
    const mintAddress = mint.toBase58();
    const existing = await redis.get<LaunchRecord>(
      launchKey(mintAddress),
    );

    if (existing && existing.creator !== creatorAddress) {
      return NextResponse.json(
        { error: "This launch is assigned to another creator." },
        { status: 409 },
      );
    }

    const record: LaunchRecord = {
      mint: mintAddress,
      creator: creatorAddress,
      name: body.name?.trim() || "Unnamed Kodiak launch",
      symbol:
        body.symbol?.replace("$", "").trim().toUpperCase() ||
        "TOKEN",
      signature,
      network: "devnet",
      createdAt: body.createdAt || new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
    };

    await redis.set(launchKey(mintAddress), record);

    if (!existing) {
      await redis.lpush(
        launchesKey(creatorAddress),
        mintAddress,
      );
    }

    return NextResponse.json({ launch: record });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to register the creator launch.",
      },
      { status: 500 },
    );
  }
}
EOF

cd "$WEB"

echo "Running lint..."
npm run lint

echo "Running production build..."
npm run build

cd "$ROOT"

git add \
  web/src/lib/server/redis.ts \
  web/src/app/api/config/route.ts \
  web/src/app/api/creator/launches/route.ts \
  web/src/app/creator/page.tsx \
  web/package.json \
  web/package-lock.json

git commit -m "stabilize creator dashboard backend" || true
git push origin main

echo ""
echo "✅ Creator Dashboard backend rebuilt and pushed."
echo ""
echo "After Vercel shows Ready:"
echo "1. Open Kodiak in the wallet browser used to launch TEST1."
echo "2. Visit /creator."
echo "3. Connect the creator wallet."
echo "4. Tap Sync Last Kodiak Launch."
