import { NextResponse } from "next/server";
import { getTrades, type StoredTrade } from "@/lib/devnet-market";

export const dynamic = "force-dynamic";

type RedisPayload<T> = { result?: T; error?: string };

type LaunchRecord = {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  signature?: string;
  network?: string;
  createdAt?: string;
  verifiedAt?: string;
};

type ActivityItem =
  | {
      id: string;
      type: "launch";
      timestamp: number;
      mint: string;
      name: string;
      symbol: string;
      creator: string;
    }
  | {
      id: string;
      type: "trade";
      timestamp: number;
      mint: string;
      name: string;
      symbol: string;
      wallet: string;
      side: "buy" | "sell";
      solAmount: number;
      tokenAmount: number;
      priceSol: number;
      signature: string;
    };

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) throw new Error("Redis REST environment variables are missing.");

  return { url: url.replace(/\/$/, ""), token };
}

async function redis<T>(command: unknown[]): Promise<T> {
  const { url, token } = redisConfig();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Redis request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as RedisPayload<T>;
  if (payload.error) throw new Error(payload.error);

  return payload.result as T;
}

function isLaunchRecord(value: unknown): value is LaunchRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<LaunchRecord>;
  return Boolean(record.mint && record.creator && record.name && record.symbol);
}

async function loadAllKeys() {
  let cursor = "0";
  const keys = new Set<string>();

  do {
    const result = await redis<[string, string[]]>([
      "SCAN",
      cursor,
      "MATCH",
      "*",
      "COUNT",
      500,
    ]);

    cursor = result?.[0] ?? "0";
    for (const key of result?.[1] ?? []) keys.add(key);
  } while (cursor !== "0");

  return [...keys];
}

async function readLaunches(keys: string[]) {
  const launches: LaunchRecord[] = [];

  for (const key of keys) {
    if (key.includes(":trades:")) continue;

    try {
      const raw = await redis<unknown>(["GET", key]);
      if (!raw) continue;

      let parsed = raw;
      if (typeof raw === "string") {
        try {
          parsed = JSON.parse(raw);
        } catch {
          continue;
        }
      }

      if (isLaunchRecord(parsed)) launches.push(parsed);
    } catch {
      // Ignore unrelated Redis keys.
    }
  }

  const unique = new Map<string, LaunchRecord>();
  for (const launch of launches) unique.set(launch.mint, launch);

  return [...unique.values()];
}

function tradeTime(trade: StoredTrade) {
  const raw = Number(trade.timestamp || 0);
  return raw > 10_000_000_000 ? Math.floor(raw / 1000) : raw;
}

export async function GET() {
  try {
    const keys = await loadAllKeys();
    const launches = await readLaunches(keys);

    const activity: ActivityItem[] = [];
    let totalTrades = 0;
    let totalVolumeSol = 0;
    let totalBuys = 0;
    let totalSells = 0;

    const tokenStats = await Promise.all(
      launches.map(async (launch) => {
        const trades = await getTrades(launch.mint);
        totalTrades += trades.length;

        let tokenVolume = 0;

        for (const trade of trades) {
          const solAmount = Number(trade.solAmount || 0);
          tokenVolume += solAmount;
          totalVolumeSol += solAmount;

          if (trade.side === "sell") totalSells += 1;
          else totalBuys += 1;
        }

        const recentTrades = [...trades]
          .sort((a, b) => tradeTime(b) - tradeTime(a))
          .slice(0, 10);

        for (const trade of recentTrades) {
          activity.push({
            id: `trade:${trade.signature}`,
            type: "trade",
            timestamp: tradeTime(trade),
            mint: launch.mint,
            name: launch.name,
            symbol: launch.symbol,
            wallet: trade.wallet,
            side: trade.side === "sell" ? "sell" : "buy",
            solAmount: Number(trade.solAmount || 0),
            tokenAmount: Number(trade.tokenAmount || 0),
            priceSol: Number(trade.priceSol || 0),
            signature: trade.signature,
          });
        }

        const created = launch.createdAt ? Date.parse(launch.createdAt) : 0;

        if (created && Number.isFinite(created)) {
          activity.push({
            id: `launch:${launch.mint}`,
            type: "launch",
            timestamp: Math.floor(created / 1000),
            mint: launch.mint,
            name: launch.name,
            symbol: launch.symbol,
            creator: launch.creator,
          });
        }

        return {
          mint: launch.mint,
          name: launch.name,
          symbol: launch.symbol,
          creator: launch.creator,
          createdAt: launch.createdAt,
          tradeCount: trades.length,
          volumeSol: tokenVolume,
          buys: trades.filter((trade) => trade.side !== "sell").length,
          sells: trades.filter((trade) => trade.side === "sell").length,
        };
      }),
    );

    activity.sort((a, b) => b.timestamp - a.timestamp);

    const trending = [...tokenStats]
      .sort((a, b) => (b.tradeCount * 2 + b.volumeSol * 5) - (a.tradeCount * 2 + a.volumeSol * 5))
      .slice(0, 5);

    return NextResponse.json(
      {
        activity: activity.slice(0, 40),
        trending,
        stats: {
          launches: launches.length,
          trades: totalTrades,
          volumeSol: totalVolumeSol,
          buys: totalBuys,
          sells: totalSells,
        },
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load live activity." },
      { status: 500 },
    );
  }
}
