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
