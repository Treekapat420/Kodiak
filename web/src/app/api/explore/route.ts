import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type RedisPayload<T> = {
  result?: T;
  error?: string;
};

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

type StoredTrade = {
  side?: "buy" | "sell";
  solAmount?: number;
  priceSol?: number;
  timestamp?: number;
};

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("Redis REST environment variables are missing.");
  }

  return {
    url: url.replace(/\/$/, ""),
    token,
  };
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

  if (payload.error) {
    throw new Error(payload.error);
  }

  return payload.result as T;
}

function isLaunchRecord(value: unknown): value is LaunchRecord {
  if (!value || typeof value !== "object") return false;

  const record = value as Partial<LaunchRecord>;

  return Boolean(
    record.mint &&
      record.creator &&
      record.name &&
      record.symbol,
  );
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

    for (const key of result?.[1] ?? []) {
      keys.add(key);
    }
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

      if (isLaunchRecord(parsed)) {
        launches.push(parsed);
      }
    } catch {
      // Lists, sets, and unrelated keys are intentionally ignored.
    }
  }

  const unique = new Map<string, LaunchRecord>();

  for (const launch of launches) {
    unique.set(launch.mint, launch);
  }

  return [...unique.values()];
}

async function readTrades(mint: string) {
  try {
    const rows = await redis<string[]>([
      "LRANGE",
      `kodiak:devnet:trades:${mint}`,
      0,
      -1,
    ]);

    if (!Array.isArray(rows)) return [];

    return rows
      .map((row) => {
        try {
          return JSON.parse(row) as StoredTrade;
        } catch {
          return null;
        }
      })
      .filter((trade): trade is StoredTrade => Boolean(trade));
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const keys = await loadAllKeys();
    const launches = await readLaunches(keys);

    const enriched = await Promise.all(
      launches.map(async (launch) => {
        const trades = await readTrades(launch.mint);
        const volumeSol = trades.reduce(
          (sum, trade) => sum + Number(trade.solAmount || 0),
          0,
        );
        const buys = trades.filter((trade) => trade.side !== "sell").length;
        const sells = trades.filter((trade) => trade.side === "sell").length;
        const latestTrade = [...trades].sort(
          (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0),
        )[0];

        return {
          ...launch,
          tradeCount: trades.length,
          buys,
          sells,
          volumeSol,
          latestPriceSol: Number(latestTrade?.priceSol || 0),
          latestTradeAt: Number(latestTrade?.timestamp || 0),
        };
      }),
    );

    enriched.sort((a, b) => {
      const aTime =
        a.latestTradeAt ||
        Date.parse(a.createdAt || "") / 1000 ||
        0;
      const bTime =
        b.latestTradeAt ||
        Date.parse(b.createdAt || "") / 1000 ||
        0;

      return bTime - aTime;
    });

    return NextResponse.json(
      {
        launches: enriched,
        count: enriched.length,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load Explore launches.",
      },
      { status: 500 },
    );
  }
}
