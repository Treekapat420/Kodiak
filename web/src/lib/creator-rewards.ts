import type { StoredTrade } from "@/lib/devnet-market";
import {
  KODIAK_IS_DEVNET,
  KODIAK_NETWORK,
} from "@/lib/solana/network";

type RedisPayload<T> = {
  result?: T;
  error?: string;
};

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
  network: typeof KODIAK_NETWORK;
};

type LaunchRecord = {
  mint: string;
  creator: string;
  name?: string;
  symbol?: string;
  network?: string;
  createdAt?: string;
};

const CREATOR_RATE = 0.0045;
const KODIAK_RATE = 0.005;
const INFRA_RATE = 0.0025;
const SUCCESS_SHARE = 0.05;

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

function isLaunch(
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
      record.creator,
  );
}

/*
 * Preserve the existing Devnet launch key exactly so Creator Dashboard and
 * reward history continue to work with all previously registered test tokens.
 *
 * Mainnet will use a separate namespace.
 */
function launchKey(
  mint: string,
) {
  return KODIAK_IS_DEVNET
    ? `kodiak:launch:${mint}`
    : `kodiak:mainnet:launch:${mint}`;
}

/*
 * Preserve the current Devnet reward and ledger key names so existing test
 * reward history is not lost during the network refactor.
 */
function rewardKey(
  signature: string,
) {
  return KODIAK_IS_DEVNET
    ? `kodiak:creator:reward:${signature}`
    : `kodiak:mainnet:creator:reward:${signature}`;
}

function creatorLedgerKey(
  creator: string,
) {
  return KODIAK_IS_DEVNET
    ? `kodiak:creator:ledger:${creator}`
    : `kodiak:mainnet:creator:ledger:${creator}`;
}

export async function findLaunchByMint(
  mint: string,
): Promise<LaunchRecord | null> {
  const raw =
    await redis<unknown>([
      "GET",
      launchKey(mint),
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
        JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (
    !isLaunch(parsed) ||
    parsed.mint !== mint
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
}

function unix(
  value: number,
) {
  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return Math.floor(
      Date.now() / 1000,
    );
  }

  return value >
    10_000_000_000
    ? Math.floor(
        value / 1000,
      )
    : Math.floor(
        value,
      );
}

export async function recordCreatorReward(
  trade: StoredTrade,
) {
  if (
    !trade?.signature ||
    !trade?.mint
  ) {
    return null;
  }

  const launch =
    await findLaunchByMint(
      trade.mint,
    );

  if (!launch?.creator) {
    return null;
  }

  const solAmount =
    Number(
      trade.solAmount ||
        0,
    );

  if (
    !Number.isFinite(
      solAmount,
    ) ||
    solAmount <= 0
  ) {
    return null;
  }

  const entry: RewardEntry = {
    id:
      `reward:${trade.signature}`,
    signature:
      trade.signature,
    mint:
      trade.mint,
    creator:
      launch.creator,
    side:
      trade.side ===
      "sell"
        ? "sell"
        : "buy",
    solAmount,
    creatorRewardSol:
      solAmount *
      CREATOR_RATE,
    kodiakFeeSol:
      solAmount *
      KODIAK_RATE,
    infraFeeSol:
      solAmount *
      INFRA_RATE,
    successFundSol:
      solAmount *
      KODIAK_RATE *
      SUCCESS_SHARE,
    timestamp:
      unix(
        Number(
          trade.timestamp ||
            0,
        ),
      ),
    status:
      "accrued",
    network:
      KODIAK_NETWORK,
  };

  const created =
    await redis<
      string | null
    >([
      "SET",
      rewardKey(
        trade.signature,
      ),
      JSON.stringify(
        entry,
      ),
      "NX",
    ]);

  if (created) {
    const ledgerKey =
      creatorLedgerKey(
        launch.creator,
      );

    await redis<number>([
      "LPUSH",
      ledgerKey,
      JSON.stringify(
        entry,
      ),
    ]);

    await redis<number>([
      "LTRIM",
      ledgerKey,
      0,
      4999,
    ]);
  }

  return entry;
}

export async function getCreatorLedger(
  creator: string,
) {
  const rows =
    await redis<
      string[]
    >([
      "LRANGE",
      creatorLedgerKey(
        creator,
      ),
      0,
      -1,
    ]);

  return (
    Array.isArray(rows)
      ? rows
      : []
  )
    .map((row) => {
      try {
        return JSON.parse(
          row,
        ) as RewardEntry;
      } catch {
        return null;
      }
    })
    .filter(
      (
        entry,
      ): entry is RewardEntry =>
        entry !== null,
    )
    .filter(
      (entry) =>
        !entry.network ||
        entry.network ===
          KODIAK_NETWORK,
    )
    .sort(
      (a, b) =>
        b.timestamp -
        a.timestamp,
    );
}
