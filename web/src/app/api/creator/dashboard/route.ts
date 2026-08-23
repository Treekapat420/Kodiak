import { NextRequest, NextResponse } from "next/server";
import { KODIAK_FEES } from "@/lib/fees";

import {
  getCreatorLedger,
  recordCreatorReward,
} from "@/lib/creator-rewards";
import { getSyncedTrades } from "@/lib/market-sync";
import { isKodiakArchivedMint } from "@/lib/archived-tokens";
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
  network?: string;
  createdAt?: string;
};

type FoundingCreatorStatus = {
  isFoundingCreator: boolean;
  number: number | null;
  label: string | null;
};

const FOUNDING_CREATOR_LIMIT = 100;

function config() {
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
  const { url, token } = config();

  const response = await fetch(
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
      `Redis request failed: ${response.status}`,
    );
  }

  const body =
    (await response.json()) as RedisPayload<T>;

  if (body.error) {
    throw new Error(
      body.error,
    );
  }

  return body.result as T;
}

/*
 * Preserve all existing Devnet keys exactly so current Creator Dashboard
 * history and Founding Creator assignments remain intact.
 *
 * Mainnet uses a separate namespace when it is eventually enabled.
 */
function foundingWalletKey(
  wallet: string,
) {
  return KODIAK_IS_DEVNET
    ? `kodiak:devnet:founding-creators:wallet:${wallet}:v1`
    : `kodiak:mainnet:founding-creators:wallet:${wallet}:v1`;
}

function creatorLaunchesKey(
  wallet: string,
) {
  return KODIAK_IS_DEVNET
    ? `kodiak:creator:${wallet}:launches`
    : `kodiak:mainnet:creator:${wallet}:launches`;
}

function launchKey(
  mint: string,
) {
  return KODIAK_IS_DEVNET
    ? `kodiak:launch:${mint}`
    : `kodiak:mainnet:launch:${mint}`;
}

function formatFounderLabel(
  number: number,
) {
  return `FOUNDING CREATOR #${String(number).padStart(3, "0")}`;
}

async function getFoundingCreatorStatus(
  wallet: string,
): Promise<FoundingCreatorStatus> {
  const stored =
    await redis<
      number | string | null
    >([
      "GET",
      foundingWalletKey(
        wallet,
      ),
    ]);

  const number =
    typeof stored === "number"
      ? stored
      : typeof stored === "string"
        ? Number.parseInt(
            stored,
            10,
          )
        : NaN;

  if (
    !Number.isInteger(
      number,
    ) ||
    number < 1 ||
    number >
      FOUNDING_CREATOR_LIMIT
  ) {
    return {
      isFoundingCreator:
        false,
      number:
        null,
      label:
        null,
    };
  }

  return {
    isFoundingCreator:
      true,
    number,
    label:
      formatFounderLabel(
        number,
      ),
  };
}

function isLaunch(
  value: unknown,
): value is LaunchRecord {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return false;
  }

  const launch =
    value as Partial<LaunchRecord>;

  return Boolean(
    launch.mint &&
      launch.creator &&
      launch.name &&
      launch.symbol,
  );
}

async function creatorLaunches(
  wallet: string,
): Promise<LaunchRecord[]> {
  const mints =
    await redis<string[]>([
      "LRANGE",
      creatorLaunchesKey(
        wallet,
      ),
      0,
      99,
    ]);

  if (
    !Array.isArray(
      mints,
    ) ||
    mints.length === 0
  ) {
    return [];
  }

  const records =
    await Promise.all(
      mints.map(
        async (mint) => {
          try {
            const raw =
              await redis<unknown>([
                "GET",
                launchKey(
                  mint,
                ),
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
              !isLaunch(
                parsed,
              )
            ) {
              return null;
            }

            if (
              parsed.creator.toLowerCase() !==
              wallet.toLowerCase()
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

  return records.filter(
    (
      record,
    ): record is LaunchRecord =>
      record !== null &&
      !isKodiakArchivedMint(
        record.mint,
      ),
  );
}

export async function GET(
  request: NextRequest,
) {
  try {
    const wallet =
      request.nextUrl.searchParams
        .get("wallet")
        ?.trim();

    if (!wallet) {
      return NextResponse.json(
        {
          error:
            "wallet is required",
        },
        {
          status: 400,
        },
      );
    }

    const [
      launches,
      foundingCreator,
    ] =
      await Promise.all([
        creatorLaunches(
          wallet,
        ),
        getFoundingCreatorStatus(
          wallet,
        ),
      ]);

    const enriched =
      await Promise.all(
        launches.map(
          async (
            launch,
          ) => {
            const trades =
              await getSyncedTrades(
                launch.mint,
              );

            /*
             * Backfill older recorded trades into the creator ledger.
             * recordCreatorReward uses SET NX, so this remains idempotent.
             */
            for (
              const trade of
              trades
            ) {
              try {
                await recordCreatorReward(
                  trade,
                );
              } catch {
                // Dashboard loading should not fail because one ledger
                // backfill entry could not be written.
              }
            }

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

            return {
              ...launch,
              trades:
                trades.length,
              buys:
                trades.filter(
                  (
                    trade,
                  ) =>
                    trade.side !==
                    "sell",
                ).length,
              sells:
                trades.filter(
                  (
                    trade,
                  ) =>
                    trade.side ===
                    "sell",
                ).length,
              volumeSol,
            };
          },
        ),
      );

    const ledger =
      await getCreatorLedger(
        wallet,
      );

    const totals =
      ledger.reduce(
        (
          total,
          entry,
        ) => {
          total.creatorRewardsSol +=
            entry.creatorRewardSol;

          total.kodiakFeesSol +=
            entry.kodiakFeeSol;

          total.infraFeesSol +=
            entry.infraFeeSol;

          total.successFundSol +=
            entry.successFundSol;

          total.trackedVolumeSol +=
            entry.solAmount;

          return total;
        },
        {
          creatorRewardsSol:
            0,
          kodiakFeesSol:
            0,
          infraFeesSol:
            0,
          successFundSol:
            0,
          trackedVolumeSol:
            0,
        },
      );

    return NextResponse.json(
      {
        network:
          KODIAK_NETWORK,
        wallet,
        launches:
          enriched,
        ledger,
        foundingCreator,
        totals: {
          ...totals,
          launchCount:
            enriched.length,
          tradeCount:
            enriched.reduce(
              (
                sum,
                launch,
              ) =>
                sum +
                launch.trades,
              0,
            ),
        },
        feeModel: {
          creatorRate:
            KODIAK_FEES.creatorCurveRate,
          kodiakRate:
            KODIAK_FEES.kodiakPlatformRate,
          infraRate:
            KODIAK_FEES.raydiumProtocolRate,
          successFundShareOfKodiak:
            KODIAK_FEES.creatorSuccessFundShareOfKodiakRevenue,
          /*
           * This dashboard ledger is analytics/accounting only.
           * Actual creator claimability is determined separately by
           * Raydium's on-chain creator-fee vault.
           */
          ledgerIsOnChainAuthority:
            false,
        },
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
            : "Unable to load creator dashboard.",
      },
      {
        status: 500,
      },
    );
  }
}
