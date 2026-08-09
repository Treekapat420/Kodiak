import { NextResponse } from "next/server";

import {
  getTrades,
} from "@/lib/devnet-market";
import {
  KODIAK_IS_DEVNET,
  KODIAK_NETWORK,
} from "@/lib/solana/network";

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

function redisConfig() {
  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL;

  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      "Redis REST environment variables are missing.",
    );
  }

  return {
    url: url.replace(/\/$/, ""),
    token,
  };
}

async function redis<T>(
  command: unknown[],
): Promise<T> {
  const { url, token } =
    redisConfig();

  const response =
    await fetch(
      url,
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${token}`,
          "Content-Type":
            "application/json",
        },
        body:
          JSON.stringify(
            command,
          ),
        cache:
          "no-store",
      },
    );

  if (!response.ok) {
    throw new Error(
      `Redis request failed with status ${response.status}.`,
    );
  }

  const payload =
    (await response.json()) as RedisPayload<T>;

  if (payload.error) {
    throw new Error(
      payload.error,
    );
  }

  return payload.result as T;
}

function isLaunchRecord(
  value: unknown,
): value is LaunchRecord {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return false;
  }

  const record =
    value as Partial<LaunchRecord>;

  return Boolean(
    record.mint &&
      record.creator &&
      record.name &&
      record.symbol,
  );
}

/*
 * Preserve the existing Devnet launch-key namespace exactly.
 * Mainnet launch records use their own namespace.
 */
function launchKeyPattern() {
  return KODIAK_IS_DEVNET
    ? "kodiak:launch:*"
    : "kodiak:mainnet:launch:*";
}

async function loadLaunchKeys() {
  let cursor = "0";
  const keys =
    new Set<string>();

  do {
    const result =
      await redis<
        [
          string,
          string[],
        ]
      >([
        "SCAN",
        cursor,
        "MATCH",
        launchKeyPattern(),
        "COUNT",
        500,
      ]);

    cursor =
      result?.[0] ??
      "0";

    for (
      const key of
      result?.[1] ??
      []
    ) {
      keys.add(key);
    }
  } while (
    cursor !== "0"
  );

  return [...keys];
}

async function readLaunches(
  keys: string[],
) {
  const records =
    await Promise.all(
      keys.map(
        async (
          key,
        ): Promise<LaunchRecord | null> => {
          try {
            const raw =
              await redis<unknown>([
                "GET",
                key,
              ]);

            if (!raw) {
              return null;
            }

            let parsed:
              unknown = raw;

            if (
              typeof raw ===
              "string"
            ) {
              try {
                parsed =
                  JSON.parse(
                    raw,
                  );
              } catch {
                return null;
              }
            }

            if (
              !isLaunchRecord(
                parsed,
              )
            ) {
              return null;
            }

            if (
              parsed.network &&
              parsed.network !==
                KODIAK_NETWORK
            ) {
              return null;
            }

            return parsed;
          } catch {
            return null;
          }
        },
      ),
    );

  const unique =
    new Map<
      string,
      LaunchRecord
    >();

  for (
    const launch of
    records
  ) {
    if (!launch) {
      continue;
    }

    unique.set(
      launch.mint,
      launch,
    );
  }

  return [
    ...unique.values(),
  ];
}

export async function GET() {
  try {
    const keys =
      await loadLaunchKeys();

    const launches =
      await readLaunches(
        keys,
      );

    const enriched =
      await Promise.all(
        launches.map(
          async (
            launch,
          ) => {
            const trades =
              await getTrades(
                launch.mint,
              );

            const volumeSol =
              trades.reduce(
                (
                  sum,
                  trade,
                ) =>
                  sum +
                  Number(
                    trade.solAmount ||
                      0,
                  ),
                0,
              );

            const buys =
              trades.filter(
                (
                  trade,
                ) =>
                  trade.side !==
                  "sell",
              ).length;

            const sells =
              trades.filter(
                (
                  trade,
                ) =>
                  trade.side ===
                  "sell",
              ).length;

            const latestTrade =
              trades.length > 0
                ? trades[
                    trades.length -
                      1
                  ]
                : undefined;

            return {
              ...launch,
              network:
                launch.network ??
                KODIAK_NETWORK,
              tradeCount:
                trades.length,
              buys,
              sells,
              volumeSol,
              latestPriceSol:
                Number(
                  latestTrade?.priceSol ||
                    0,
                ),
              latestTradeAt:
                Number(
                  latestTrade?.timestamp ||
                    0,
                ),
            };
          },
        ),
      );

    enriched.sort(
      (
        a,
        b,
      ) => {
        const aTime =
          a.latestTradeAt ||
          Date.parse(
            a.createdAt ||
              "",
          ) /
            1000 ||
          0;

        const bTime =
          b.latestTradeAt ||
          Date.parse(
            b.createdAt ||
              "",
          ) /
            1000 ||
          0;

        return (
          bTime -
          aTime
        );
      },
    );

    return NextResponse.json(
      {
        network:
          KODIAK_NETWORK,
        launches:
          enriched,
        count:
          enriched.length,
      },
      {
        headers: {
          "Cache-Control":
            "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof
          Error
            ? error.message
            : "Unable to load Explore launches.",
        network:
          KODIAK_NETWORK,
      },
      {
        status: 500,
      },
    );
  }
}
