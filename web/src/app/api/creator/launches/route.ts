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

type FoundingCreatorStatus = {
  isFoundingCreator: boolean;
  number: number | null;
  label: string | null;
};

const FOUNDING_CREATOR_LIMIT = 100;

const FOUNDING_COUNTER_KEY =
  "kodiak:devnet:founding-creators:counter:v1";

const FOUNDING_REGISTRY_KEY =
  "kodiak:devnet:founding-creators:registry:v1";

function foundingWalletKey(wallet: string) {
  return `kodiak:devnet:founding-creators:wallet:${wallet}:v1`;
}

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

function formatFounderLabel(number: number) {
  return `FOUNDING CREATOR #${String(number).padStart(3, "0")}`;
}

async function getFoundingCreatorStatus(
  wallet: string,
): Promise<FoundingCreatorStatus> {
  const redis = getRedis();

  const stored = await redis.get<number | string>(
    foundingWalletKey(wallet),
  );

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

async function assignFoundingCreator(
  wallet: string,
): Promise<FoundingCreatorStatus> {
  const redis = getRedis();

  const script = `
    local existing = redis.call("GET", KEYS[1])

    if existing then
      return tonumber(existing)
    end

    local current = tonumber(redis.call("GET", KEYS[2]) or "0")

    if current >= tonumber(ARGV[2]) then
      return 0
    end

    local number = redis.call("INCR", KEYS[2])

    redis.call("SET", KEYS[1], tostring(number))
    redis.call("ZADD", KEYS[3], number, ARGV[1])

    return number
  `;

  const result = await redis.eval(
    script,
    [
      foundingWalletKey(wallet),
      FOUNDING_COUNTER_KEY,
      FOUNDING_REGISTRY_KEY,
    ],
    [wallet, String(FOUNDING_CREATOR_LIMIT)],
  );

  const number =
    typeof result === "number"
      ? result
      : Number.parseInt(String(result), 10);

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

    const foundingCreator =
      await getFoundingCreatorStatus(creatorAddress);

    return NextResponse.json({
      launches,
      foundingCreator,
    });
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

    const accountKeys =
      transaction.transaction.message.accountKeys;

    const signer = accountKeys.find(
      (entry) => entry.signer,
    )?.pubkey;

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
        {
          error:
            "This launch is assigned to another creator.",
        },
        { status: 409 },
      );
    }

    const record: LaunchRecord = {
      mint: mintAddress,
      creator: creatorAddress,
      name: body.name?.trim() || "Unnamed Kodiak launch",
      symbol:
        body.symbol
          ?.replace("$", "")
          .trim()
          .toUpperCase() || "TOKEN",
      signature,
      network: "devnet",
      createdAt: body.createdAt || new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
    };

    await redis.set(
      launchKey(mintAddress),
      record,
    );

    let foundingCreator =
      await getFoundingCreatorStatus(creatorAddress);

    if (!existing) {
      await redis.lpush(
        launchesKey(creatorAddress),
        mintAddress,
      );

      foundingCreator =
        await assignFoundingCreator(creatorAddress);
    }

    return NextResponse.json({
      launch: record,
      foundingCreator,
    });
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
