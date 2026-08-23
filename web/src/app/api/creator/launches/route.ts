import { NextRequest, NextResponse } from "next/server";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import {
  getPdaLaunchpadPoolId,
  LaunchpadPool,
} from "@raydium-io/raydium-sdk-v2";

import {
  KODIAK_LAUNCHPAD_PROGRAM_ID,
} from "@/lib/raydium/devnet";
import {
  KODIAK_IS_DEVNET,
  KODIAK_IS_MAINNET,
  KODIAK_NETWORK,
  KODIAK_RPC_URL,
} from "@/lib/solana/network";
import { getRedis } from "@/lib/server/redis";
import { isKodiakArchivedMint } from "@/lib/archived-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LaunchRecord = {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  signature: string;
  network: typeof KODIAK_NETWORK;
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
  KODIAK_IS_DEVNET
    ? "kodiak:devnet:founding-creators:counter:v1"
    : "kodiak:mainnet:founding-creators:counter:v1";

const FOUNDING_REGISTRY_KEY =
  KODIAK_IS_DEVNET
    ? "kodiak:devnet:founding-creators:registry:v1"
    : "kodiak:mainnet:founding-creators:registry:v1";

function foundingWalletKey(wallet: string) {
  return KODIAK_IS_DEVNET
    ? `kodiak:devnet:founding-creators:wallet:${wallet}:v1`
    : `kodiak:mainnet:founding-creators:wallet:${wallet}:v1`;
}

function serverRpcUrl() {
  /*
   * Mainnet must never fall back through the generic SOLANA_RPC_URL.
   * That variable may still point at Devnet from Kodiak's test setup.
   *
   * KODIAK_RPC_URL already fails closed when Mainnet is enabled without
   * NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL, so Mainnet verification is allowed
   * to use only the dedicated server Mainnet RPC override or KODIAK_RPC_URL.
   */
  if (KODIAK_IS_MAINNET) {
    return (
      process.env.SOLANA_MAINNET_RPC_URL?.trim() ||
      KODIAK_RPC_URL
    );
  }

  return (
    process.env.SOLANA_DEVNET_RPC_URL?.trim() ||
    process.env.SOLANA_RPC_URL?.trim() ||
    KODIAK_RPC_URL
  );
}

function getConnection() {
  return new Connection(serverRpcUrl(), "confirmed");
}

function launchesKey(creator: string) {
  return KODIAK_IS_DEVNET
    ? `kodiak:creator:${creator}:launches`
    : `kodiak:mainnet:creator:${creator}:launches`;
}

function launchKey(mint: string) {
  return KODIAK_IS_DEVNET
    ? `kodiak:launch:${mint}`
    : `kodiak:mainnet:launch:${mint}`;
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

function networkLabel() {
  return KODIAK_IS_DEVNET ? "Devnet" : "Mainnet";
}

function cleanName(value?: string) {
  const name = value?.trim() ?? "";
  return name.slice(0, 64) || "Unnamed Kodiak launch";
}

function cleanSymbol(value?: string) {
  const symbol =
    value
      ?.replace("$", "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .trim()
      .toUpperCase() ?? "";

  return symbol.slice(0, 10) || "TOKEN";
}

async function getKodiakPlatformId() {
  /*
   * /api/config is ultimately backed by Kodiak's configured PlatformConfig.
   * Read the same server-side environment value here so launch registration
   * cannot accept a Raydium launch belonging to another platform.
   */
  const value =
    KODIAK_IS_DEVNET
      ? (
          process.env.KODIAK_DEVNET_PLATFORM_ID?.trim() ||
          process.env.NEXT_PUBLIC_KODIAK_DEVNET_PLATFORM_ID?.trim()
        )
      : (
          process.env.KODIAK_MAINNET_PLATFORM_ID?.trim() ||
          process.env.NEXT_PUBLIC_KODIAK_MAINNET_PLATFORM_ID?.trim()
        );

  if (!value) {
    throw new Error(
      `Kodiak's ${networkLabel()} PlatformConfig is not configured on the server.`,
    );
  }

  const platformId = parsePublicKey(value);

  if (!platformId) {
    throw new Error(
      `Kodiak's configured ${networkLabel()} PlatformConfig is invalid.`,
    );
  }

  return platformId;
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
    [
      wallet,
      String(FOUNDING_CREATOR_LIMIT),
    ],
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
      (record): record is LaunchRecord =>
        record !== null &&
        record.network === KODIAK_NETWORK &&
        record.creator === creatorAddress &&
        !isKodiakArchivedMint(record.mint),
    );

    const foundingCreator =
      await getFoundingCreatorStatus(creatorAddress);

    return NextResponse.json({
      network: KODIAK_NETWORK,
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
    const body =
      (await request.json()) as {
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

    const transaction =
      await connection.getParsedTransaction(
        signature,
        {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        },
      );

    if (!transaction || transaction.meta?.err) {
      return NextResponse.json(
        {
          error:
            `The ${networkLabel()} launch transaction was not found or failed.`,
        },
        { status: 400 },
      );
    }

    const accountKeys =
      transaction.transaction.message.accountKeys;

    /*
     * Verify the CLAIMED creator was actually a signer. Do not assume the
     * first signer is necessarily the creator.
     */
    const creatorSigned =
      accountKeys.some(
        (entry) =>
          entry.signer &&
          entry.pubkey.equals(creator),
      );

    const containsMint =
      accountKeys.some(
        (entry) =>
          entry.pubkey.equals(mint),
      );

    const invokesLaunchLab =
      accountKeys.some(
        (entry) =>
          entry.pubkey.equals(
            KODIAK_LAUNCHPAD_PROGRAM_ID,
          ),
      );

    if (!creatorSigned) {
      return NextResponse.json(
        {
          error:
            "The claimed creator wallet did not sign this transaction.",
        },
        { status: 403 },
      );
    }

    if (!containsMint || !invokesLaunchLab) {
      return NextResponse.json(
        {
          error:
            "This transaction could not be verified as a Raydium LaunchLab creation transaction for the submitted mint.",
        },
        { status: 403 },
      );
    }

    /*
     * The mint existing by itself is not enough. A verified Kodiak launch
     * must have the deterministic Raydium LaunchLab pool for mint/SOL.
     */
    const poolId =
      getPdaLaunchpadPoolId(
        KODIAK_LAUNCHPAD_PROGRAM_ID,
        mint,
        NATIVE_MINT,
      ).publicKey;

    const [mintAccount, poolAccount, kodiakPlatformId] =
      await Promise.all([
        connection.getAccountInfo(
          mint,
          "confirmed",
        ),
        connection.getAccountInfo(
          poolId,
          "confirmed",
        ),
        getKodiakPlatformId(),
      ]);

    if (!mintAccount) {
      return NextResponse.json(
        {
          error:
            `The token mint was not found on Solana ${networkLabel()}.`,
        },
        { status: 404 },
      );
    }

    if (!poolAccount) {
      return NextResponse.json(
        {
          error:
            "The deterministic Raydium LaunchLab pool for this mint does not exist on the active network.",
        },
        { status: 404 },
      );
    }

    let poolInfo: ReturnType<typeof LaunchpadPool.decode>;

    try {
      poolInfo =
        LaunchpadPool.decode(
          poolAccount.data,
        );
    } catch {
      return NextResponse.json(
        {
          error:
            "The expected LaunchLab pool account exists but could not be decoded.",
        },
        { status: 422 },
      );
    }

    /*
     * Bind registration to Kodiak's own PlatformConfig and to the expected
     * mint/SOL pair. This prevents another LaunchLab platform's token from
     * being registered as a Kodiak launch.
     */
    if (
      !poolInfo.mintA.equals(mint) ||
      !poolInfo.mintB.equals(NATIVE_MINT)
    ) {
      return NextResponse.json(
        {
          error:
            "The verified LaunchLab pool does not match the submitted mint/SOL pair.",
        },
        { status: 403 },
      );
    }

    if (
      !poolInfo.platformId.equals(
        kodiakPlatformId,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "This LaunchLab pool belongs to a different platform and cannot be registered as a Kodiak launch.",
        },
        { status: 403 },
      );
    }

    /*
     * Use the confirmed block time as the authoritative creation time when
     * available. Browser-supplied createdAt is not trusted.
     */
    const createdAt =
      typeof transaction.blockTime === "number"
        ? new Date(
            transaction.blockTime * 1000,
          ).toISOString()
        : new Date().toISOString();

    const redis = getRedis();
    const creatorAddress = creator.toBase58();
    const mintAddress = mint.toBase58();

    const existing =
      await redis.get<LaunchRecord>(
        launchKey(mintAddress),
      );

    if (
      existing &&
      existing.creator !== creatorAddress
    ) {
      return NextResponse.json(
        {
          error:
            "This launch is assigned to another creator.",
        },
        { status: 409 },
      );
    }

    if (
      existing &&
      existing.network !== KODIAK_NETWORK
    ) {
      return NextResponse.json(
        {
          error:
            "This stored launch belongs to a different Kodiak network namespace.",
        },
        { status: 409 },
      );
    }

    const record: LaunchRecord = {
      mint: mintAddress,
      creator: creatorAddress,
      name: cleanName(body.name),
      symbol: cleanSymbol(body.symbol),
      signature,
      network: KODIAK_NETWORK,
      createdAt,
      verifiedAt: new Date().toISOString(),
    };

    await redis.set(
      launchKey(mintAddress),
      record,
    );

    let foundingCreator =
      await getFoundingCreatorStatus(
        creatorAddress,
      );

    /*
     * A Founding Creator slot is assigned only after every on-chain
     * verification above has passed and only for a newly registered launch.
     */
    if (!existing) {
      await redis.lpush(
        launchesKey(creatorAddress),
        mintAddress,
      );

      foundingCreator =
        await assignFoundingCreator(
          creatorAddress,
        );
    }

    return NextResponse.json({
      network: KODIAK_NETWORK,
      launch: record,
      foundingCreator,
      verification: {
        creatorSigned: true,
        launchLabProgramInvoked: true,
        launchpadPool:
          poolId.toBase58(),
        platformId:
          poolInfo.platformId.toBase58(),
      },
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
