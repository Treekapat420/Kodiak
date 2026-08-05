import { NextRequest, NextResponse } from "next/server";
import { getTrades } from "@/lib/devnet-market";
import { getCreatorLedger, recordCreatorReward } from "@/lib/creator-rewards";

export const dynamic = "force-dynamic";

type RedisPayload<T> = { result?: T; error?: string };

type LaunchRecord = {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  createdAt?: string;
};

type FoundingCreatorStatus = {
  isFoundingCreator: boolean;
  number: number | null;
  label: string | null;
};

const FOUNDING_CREATOR_LIMIT = 100;

function config() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("Redis REST environment variables are missing.");
  }

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

function foundingWalletKey(wallet: string) {
  return `kodiak:devnet:founding-creators:wallet:${wallet}:v1`;
}

function formatFounderLabel(number: number) {
  return `FOUNDING CREATOR #${String(number).padStart(3, "0")}`;
}

async function getFoundingCreatorStatus(
  wallet: string,
): Promise<FoundingCreatorStatus> {
  const stored = await redis<number | string | null>([
    "GET",
    foundingWalletKey(wallet),
  ]);

  const number =
    typeof stored === "number"
      ? stored
      : typeof stored === "string"
        ? Number.parseInt(stored, 10)
        : NaN;

  if (
    !Number.isInteger(number) ||
    number < 1 ||
    number > FOUNDING_CREATOR_LIMIT
  ) {
    return {
      isFoundingCreator: false,
      number: null,
      label: null,
    };
  }

  return {
    isFoundingCreator: true,
    number,
    label: formatFounderLabel(number),
  };
}

async function allKeys() {
  let cursor = "0";
  const out = new Set<string>();

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
      out.add(key);
    }
  } while (cursor !== "0");

  return [...out];
}

function isLaunch(value: unknown): value is LaunchRecord {
  if (!value || typeof value !== "object") return false;

  const launch = value as Partial<LaunchRecord>;
  return Boolean(
    launch.mint &&
      launch.creator &&
      launch.name &&
      launch.symbol,
  );
}

async function creatorLaunches(wallet: string) {
  const found: LaunchRecord[] = [];

  for (const key of await allKeys()) {
    if (
      key.includes(":trades:") ||
      key.startsWith("kodiak:creator:reward:") ||
      key.startsWith("kodiak:creator:ledger:")
    ) {
      continue;
    }

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

      if (
        isLaunch(parsed) &&
        parsed.creator.toLowerCase() === wallet.toLowerCase()
      ) {
        found.push(parsed);
      }
    } catch {}
  }

  return [...new Map(found.map((launch) => [launch.mint, launch])).values()];
}

export async function GET(request: NextRequest) {
  try {
    const wallet = request.nextUrl.searchParams.get("wallet")?.trim();

    if (!wallet) {
      return NextResponse.json(
        { error: "wallet is required" },
        { status: 400 },
      );
    }

    const [launches, foundingCreator] = await Promise.all([
      creatorLaunches(wallet),
      getFoundingCreatorStatus(wallet),
    ]);

    const enriched = await Promise.all(
      launches.map(async (launch) => {
        const trades = await getTrades(launch.mint);

        // Backfill prior Devnet trades once; SET NX makes this idempotent.
        for (const trade of trades) {
          try {
            await recordCreatorReward(trade);
          } catch {}
        }

        const volumeSol = trades.reduce(
          (sum, trade) => sum + Number(trade.solAmount || 0),
          0,
        );

        return {
          ...launch,
          trades: trades.length,
          buys: trades.filter((trade) => trade.side !== "sell").length,
          sells: trades.filter((trade) => trade.side === "sell").length,
          volumeSol,
        };
      }),
    );

    const ledger = await getCreatorLedger(wallet);

    const totals = ledger.reduce(
      (total, entry) => {
        total.creatorRewardsSol += entry.creatorRewardSol;
        total.kodiakFeesSol += entry.kodiakFeeSol;
        total.infraFeesSol += entry.infraFeeSol;
        total.successFundSol += entry.successFundSol;
        total.trackedVolumeSol += entry.solAmount;
        return total;
      },
      {
        creatorRewardsSol: 0,
        kodiakFeesSol: 0,
        infraFeesSol: 0,
        successFundSol: 0,
        trackedVolumeSol: 0,
      },
    );

    return NextResponse.json(
      {
        wallet,
        launches: enriched,
        ledger,
        foundingCreator,
        totals: {
          ...totals,
          launchCount: enriched.length,
          tradeCount: enriched.reduce(
            (sum, launch) => sum + launch.trades,
            0,
          ),
        },
        feeModel: {
          creatorRate: 0.0045,
          kodiakRate: 0.005,
          infraRate: 0.0025,
          successFundShareOfKodiak: 0.05,
          claimableOnChain: false,
        },
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
            : "Unable to load creator dashboard.",
      },
      { status: 500 },
    );
  }
}
