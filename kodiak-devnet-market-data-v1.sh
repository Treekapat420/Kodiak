#!/usr/bin/env bash
set -euo pipefail
ROOT="/workspaces/Kodiak"
WEB="$ROOT/web"
TRADE_PAGE="$WEB/src/app/trade/page.tsx"
CHART_ROUTE="$WEB/src/app/api/token/[mint]/chart/route.ts"
TRADES_ROUTE="$WEB/src/app/api/token/[mint]/trades/route.ts"
LIB="$WEB/src/lib/devnet-market.ts"

echo "🐻 Installing Kodiak Devnet market-data service..."
for f in "$TRADE_PAGE" "$CHART_ROUTE"; do
  [ -f "$f" ] || { echo "Missing required file: $f"; exit 1; }
done
mkdir -p "$(dirname "$TRADES_ROUTE")" "$(dirname "$LIB")"
cp "$TRADE_PAGE" "$TRADE_PAGE.bak-devnet-market"
cp "$CHART_ROUTE" "$CHART_ROUTE.bak-devnet-market"

cat > "$LIB" <<'TS'
import { Connection, PublicKey } from "@solana/web3.js";

export type StoredTrade = {
  mint: string;
  wallet: string;
  signature: string;
  side: "buy" | "sell";
  solAmount: number;
  tokenAmount: number;
  priceSol: number;
  timestamp: number;
};

const connection = new Connection(
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    process.env.SOLANA_RPC_URL ||
    "https://api.devnet.solana.com",
  "confirmed",
);

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Redis REST environment variables are missing.");
  return { url: url.replace(/\/$/, ""), token };
}

async function redis<T = unknown>(command: unknown[]): Promise<T> {
  const { url, token } = redisConfig();
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Redis request failed: ${response.status}`);
  const payload = (await response.json()) as { result?: T; error?: string };
  if (payload.error) throw new Error(payload.error);
  return payload.result as T;
}

const tradeKey = (mint: string) => `kodiak:devnet:trades:${mint}`;

export async function inferTokenAmount(signature: string, mint: string, wallet: string) {
  const parsed = await connection.getParsedTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!parsed) return { tokenAmount: 0, timestamp: Math.floor(Date.now() / 1000) };
  const owner = new PublicKey(wallet).toBase58();
  const preAmount = (parsed.meta?.preTokenBalances ?? [])
    .filter((b) => b.mint === mint && b.owner === owner)
    .reduce((sum, b) => sum + Number(b.uiTokenAmount.uiAmountString ?? "0"), 0);
  const postAmount = (parsed.meta?.postTokenBalances ?? [])
    .filter((b) => b.mint === mint && b.owner === owner)
    .reduce((sum, b) => sum + Number(b.uiTokenAmount.uiAmountString ?? "0"), 0);
  return {
    tokenAmount: Math.abs(postAmount - preAmount),
    timestamp: parsed.blockTime ?? Math.floor(Date.now() / 1000),
  };
}

export async function saveTrade(trade: StoredTrade) {
  const key = tradeKey(trade.mint);
  await redis(["RPUSH", key, JSON.stringify(trade)]);
  await redis(["LTRIM", key, -2000, -1]);
  return trade;
}

export async function getTrades(mint: string): Promise<StoredTrade[]> {
  const rows = await redis<string[]>(["LRANGE", tradeKey(mint), 0, -1]);
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    try { return JSON.parse(row) as StoredTrade; } catch { return null; }
  }).filter((row): row is StoredTrade => Boolean(row)).sort((a, b) => a.timestamp - b.timestamp);
}

export function buildCandles(trades: StoredTrade[], intervalSeconds: number) {
  const buckets = new Map<number, { time: number; open: number; high: number; low: number; close: number; volume: number }>();
  for (const trade of trades) {
    if (!Number.isFinite(trade.priceSol) || trade.priceSol <= 0) continue;
    const time = Math.floor(trade.timestamp / intervalSeconds) * intervalSeconds;
    const current = buckets.get(time);
    if (!current) {
      buckets.set(time, { time, open: trade.priceSol, high: trade.priceSol, low: trade.priceSol, close: trade.priceSol, volume: trade.solAmount });
    } else {
      current.high = Math.max(current.high, trade.priceSol);
      current.low = Math.min(current.low, trade.priceSol);
      current.close = trade.priceSol;
      current.volume += trade.solAmount;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}
TS

cat > "$TRADES_ROUTE" <<'TS'
import { NextRequest, NextResponse } from "next/server";
import { getTrades, inferTokenAmount, saveTrade, type StoredTrade } from "@/lib/devnet-market";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ mint: string }> };

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { mint } = await context.params;
    const trades = await getTrades(mint);
    return NextResponse.json({ mint, trades: [...trades].reverse().slice(0, 100) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load trades." }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { mint } = await context.params;
    const body = (await request.json()) as { wallet?: string; signature?: string; side?: "buy" | "sell"; solAmount?: number };
    if (!body.wallet || !body.signature || !body.solAmount) {
      return NextResponse.json({ error: "wallet, signature, and solAmount are required." }, { status: 400 });
    }
    const inferred = await inferTokenAmount(body.signature, mint, body.wallet);
    if (!Number.isFinite(inferred.tokenAmount) || inferred.tokenAmount <= 0) {
      return NextResponse.json({ error: "The transaction was confirmed, but its token amount could not be read yet. Retry shortly." }, { status: 409 });
    }
    const trade: StoredTrade = {
      mint,
      wallet: body.wallet,
      signature: body.signature,
      side: body.side ?? "buy",
      solAmount: Number(body.solAmount),
      tokenAmount: inferred.tokenAmount,
      priceSol: Number(body.solAmount) / inferred.tokenAmount,
      timestamp: inferred.timestamp,
    };
    await saveTrade(trade);
    return NextResponse.json({ ok: true, trade });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to record trade." }, { status: 500 });
  }
}
TS

cat > "$CHART_ROUTE" <<'TS'
import { NextRequest, NextResponse } from "next/server";
import { buildCandles, getTrades } from "@/lib/devnet-market";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ mint: string }> };
const intervalMap: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900 };

export async function GET(request: NextRequest, context: Context) {
  try {
    const { mint } = await context.params;
    const interval = request.nextUrl.searchParams.get("interval")?.toLowerCase() ?? "1m";
    const trades = await getTrades(mint);
    const candles = buildCandles(trades, intervalMap[interval] ?? 60);
    return NextResponse.json({ mint, interval, source: "kodiak-devnet", candles }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to build candles." }, { status: 500 });
  }
}
TS

python - <<'PY'
from pathlib import Path
path = Path('/workspaces/Kodiak/web/src/app/trade/page.tsx')
text = path.read_text()
needle = '''      const result = await execute({ sendAndConfirm: true });
      const signature = collectSignature(result);

      setStatus({
        kind: "success",
        message: `${buySol} Devnet SOL purchase confirmed on-chain.`,
        signature,
      });'''
replacement = '''      const result = await execute({ sendAndConfirm: true });
      const signature = collectSignature(result);

      if (!signature) {
        throw new Error("The purchase succeeded but no transaction signature was returned.");
      }

      setStatus({
        kind: "working",
        message: "Purchase confirmed. Updating the token chart...",
      });

      let recorded = false;
      for (let attempt = 0; attempt < 5 && !recorded; attempt += 1) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2500));
        const response = await fetch(`/api/token/${mint}/trades`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            wallet: publicKey.toBase58(),
            signature,
            side: "buy",
            solAmount: Number(buySol),
          }),
        });
        if (response.ok) {
          recorded = true;
          break;
        }
        if (response.status !== 409) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || "The purchase succeeded, but chart recording failed.");
        }
      }

      setStatus({
        kind: "success",
        message: recorded
          ? `${buySol} Devnet SOL purchase confirmed and added to the chart.`
          : `${buySol} Devnet SOL purchase confirmed. Chart indexing is still pending.`,
        signature,
      });'''
if needle not in text:
    raise SystemExit('Could not locate the confirmed-buy block. No patch was applied.')
path.write_text(text.replace(needle, replacement, 1))
PY

cd "$WEB"
npm run lint
npm run build
cd "$ROOT"
git add web/src/lib/devnet-market.ts web/src/app/api/token/[mint]/trades/route.ts web/src/app/api/token/[mint]/chart/route.ts web/src/app/trade/page.tsx
git commit -m "add Devnet trade recording and live candles" || true
git push origin main

echo ""
echo "✅ Kodiak Devnet market data installed and pushed."
echo "After Vercel shows Ready, make one NEW Devnet buy on TEST3."
echo "That new trade should create the first candle and chart-axis values."
echo "Old trades made before this upgrade are not imported automatically."
