import type { StoredTrade } from "@/lib/devnet-market";

type RedisPayload<T> = { result?: T; error?: string };

export type RewardEntry = {
  id: string;
  signature: string;
  mint: string;
  creator: string;
  side: "buy" | "sell";
  solAmount: number;
  creatorRewardSol: number;
  kodiakFeeSol: number;
  infraFeeSol: number;
  successFundSol: number;
  timestamp: number;
  status: "accrued";
  network: "devnet";
};

type LaunchRecord = {
  mint: string;
  creator: string;
  name?: string;
  symbol?: string;
  createdAt?: string;
};

const CREATOR_RATE = 0.0045;
const KODIAK_RATE = 0.005;
const INFRA_RATE = 0.0025;
const SUCCESS_SHARE = 0.05;

function config() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Redis REST environment variables are missing.");
  return { url: url.replace(/\/$/, ""), token };
}

async function redis<T>(command: unknown[]): Promise<T> {
  const { url, token } = config();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Redis request failed: ${res.status}`);
  const body = (await res.json()) as RedisPayload<T>;
  if (body.error) throw new Error(body.error);
  return body.result as T;
}

async function keys() {
  let cursor = "0";
  const out = new Set<string>();
  do {
    const result = await redis<[string, string[]]>([
      "SCAN", cursor, "MATCH", "*", "COUNT", 500,
    ]);
    cursor = result?.[0] ?? "0";
    for (const key of result?.[1] ?? []) out.add(key);
  } while (cursor !== "0");
  return [...out];
}

function isLaunch(v: unknown): v is LaunchRecord {
  if (!v || typeof v !== "object") return false;
  const x = v as Partial<LaunchRecord>;
  return Boolean(x.mint && x.creator);
}

export async function findLaunchByMint(mint: string) {
  for (const key of await keys()) {
    if (
      key.includes(":trades:") ||
      key.startsWith("kodiak:creator:reward:") ||
      key.startsWith("kodiak:creator:ledger:")
    ) continue;

    try {
      const raw = await redis<unknown>(["GET", key]);
      if (!raw) continue;
      let parsed = raw;
      if (typeof raw === "string") {
        try { parsed = JSON.parse(raw); } catch { continue; }
      }
      if (isLaunch(parsed) && parsed.mint === mint) return parsed;
    } catch {}
  }
  return null;
}

function unix(value: number) {
  if (!Number.isFinite(value) || value <= 0) return Math.floor(Date.now() / 1000);
  return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
}

export async function recordCreatorReward(trade: StoredTrade) {
  if (!trade?.signature || !trade?.mint) return null;

  const launch = await findLaunchByMint(trade.mint);
  if (!launch?.creator) return null;

  const solAmount = Number(trade.solAmount || 0);
  if (!Number.isFinite(solAmount) || solAmount <= 0) return null;

  const entry: RewardEntry = {
    id: `reward:${trade.signature}`,
    signature: trade.signature,
    mint: trade.mint,
    creator: launch.creator,
    side: trade.side === "sell" ? "sell" : "buy",
    solAmount,
    creatorRewardSol: solAmount * CREATOR_RATE,
    kodiakFeeSol: solAmount * KODIAK_RATE,
    infraFeeSol: solAmount * INFRA_RATE,
    successFundSol: solAmount * KODIAK_RATE * SUCCESS_SHARE,
    timestamp: unix(Number(trade.timestamp || 0)),
    status: "accrued",
    network: "devnet",
  };

  const created = await redis<string | null>([
    "SET",
    `kodiak:creator:reward:${trade.signature}`,
    JSON.stringify(entry),
    "NX",
  ]);

  if (created) {
    const ledgerKey = `kodiak:creator:ledger:${launch.creator}`;
    await redis<number>(["LPUSH", ledgerKey, JSON.stringify(entry)]);
    await redis<number>(["LTRIM", ledgerKey, 0, 4999]);
  }

  return entry;
}

export async function getCreatorLedger(creator: string) {
  const rows = await redis<string[]>([
    "LRANGE",
    `kodiak:creator:ledger:${creator}`,
    0,
    -1,
  ]);

  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      try { return JSON.parse(row) as RewardEntry; } catch { return null; }
    })
    .filter((x): x is RewardEntry => Boolean(x))
    .sort((a, b) => b.timestamp - a.timestamp);
}
