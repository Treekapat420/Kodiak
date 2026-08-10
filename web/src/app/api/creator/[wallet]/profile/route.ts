import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getRedis } from "@/lib/server/redis";
import { creatorProfileKey, creatorProfileNonceKey, getCreatorProfileMeta, type CreatorProfileMeta } from "@/lib/server/creator-profile";
import { verifySolanaMessage } from "@/lib/server/verify-solana-signature";

import { getTrades } from "@/lib/devnet-market";
import {
  KODIAK_IS_DEVNET,
  KODIAK_NETWORK,
} from "@/lib/solana/network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    wallet: string;
  }>;
};

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

type FoundingCreatorStatus = {
  isFoundingCreator: boolean;
  number: number | null;
  label: string | null;
};

const FOUNDING_CREATOR_LIMIT = 100;

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
      `Redis request failed: ${response.status}`,
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

async function loadCreatorLaunches(
  wallet: string,
) {
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
      record !== null,
  );
}

export async function GET(
  _request: NextRequest,
  context: Context,
) {
  try {
    const { wallet: rawWallet } =
      await context.params;

    let wallet: string;

    try {
      wallet =
        new PublicKey(
          rawWallet,
        ).toBase58();
    } catch {
      return NextResponse.json(
        {
          error:
            "A valid Solana creator wallet is required.",
          network:
            KODIAK_NETWORK,
        },
        {
          status: 400,
        },
      );
    }

    const [launches, foundingCreator, creatorMeta] = await Promise.all([
      loadCreatorLaunches(wallet),
      getFoundingCreatorStatus(wallet),
      getCreatorProfileMeta(wallet),
    ]);

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

            const latestTradeAt =
              trades.reduce(
                (
                  latest,
                  trade,
                ) =>
                  Math.max(
                    latest,
                    Number(
                      trade.timestamp ||
                        0,
                    ),
                  ),
                0,
              );

            return {
              mint:
                launch.mint,
              creator:
                launch.creator,
              name:
                launch.name,
              symbol:
                launch.symbol,
              network:
                launch.network ??
                KODIAK_NETWORK,
              createdAt:
                launch.createdAt,
              tradeCount:
                trades.length,
              buys,
              sells,
              volumeSol,
              latestTradeAt,
            };
          },
        ),
      );

    const totals =
      enriched.reduce(
        (
          total,
          launch,
        ) => {
          total.launchCount +=
            1;

          total.tradeCount +=
            launch.tradeCount;

          total.buys +=
            launch.buys;

          total.sells +=
            launch.sells;

          total.volumeSol +=
            launch.volumeSol;

          return total;
        },
        {
          launchCount:
            0,
          tradeCount:
            0,
          buys:
            0,
          sells:
            0,
          volumeSol:
            0,
        },
      );

    return NextResponse.json(
      {
        network:
          KODIAK_NETWORK,
        profile: {
          wallet,
          ...creatorMeta,
          foundingCreator,
          launches:
            enriched,
          totals,
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
            : "Unable to load creator profile.",
        network:
          KODIAK_NETWORK,
      },
      {
        status: 500,
      },
    );
  }
}


function cleanText(value: unknown, max: number) {
  return typeof value === "string"
    ? value.trim().slice(0, max)
    : "";
}

function cleanUrl(value: unknown, max = 300) {
  const text = cleanText(value, max);

  if (!text) {
    return "";
  }

  try {
    const url = new URL(text);

    return url.protocol === "https:" ||
      url.protocol === "http:"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

const PINATA_FILE_URL =
  "https://api.pinata.cloud/pinning/pinFileToIPFS";

const PUBLIC_GATEWAY =
  "https://gateway.pinata.cloud/ipfs";

const MAX_PROFILE_IMAGE_BYTES =
  5 * 1024 * 1024;

type PinataResponse = {
  IpfsHash?: string;
  error?: string;
};

async function uploadProfileImage(
  wallet: string,
  image: File,
) {
  const jwt =
    process.env.PINATA_JWT;

  if (!jwt) {
    throw new Error(
      "Profile image storage is not configured. PINATA_JWT is missing.",
    );
  }

  if (
    !image.type.startsWith(
      "image/",
    )
  ) {
    throw new Error(
      "Profile picture must be an image.",
    );
  }

  if (
    image.size >
    MAX_PROFILE_IMAGE_BYTES
  ) {
    throw new Error(
      "Profile picture must be 5 MB or smaller.",
    );
  }

  const upload =
    new FormData();

  upload.append(
    "file",
    image,
    image.name ||
      "creator-profile-image",
  );

  upload.append(
    "pinataMetadata",
    JSON.stringify({
      name:
        `Kodiak creator ${wallet} profile image`,
    }),
  );

  const response =
    await fetch(
      PINATA_FILE_URL,
      {
        method:
          "POST",
        headers: {
          Authorization:
            `Bearer ${jwt}`,
        },
        body:
          upload,
      },
    );

  const payload =
    (await response.json()) as PinataResponse;

  if (
    !response.ok ||
    !payload.IpfsHash
  ) {
    throw new Error(
      payload.error ||
        `Profile image upload failed with HTTP ${response.status}.`,
    );
  }

  return `${PUBLIC_GATEWAY}/${payload.IpfsHash}`;
}

async function readProfileUpdate(
  request: NextRequest,
) {
  const contentType =
    request.headers.get(
      "content-type",
    ) ?? "";

  if (
    contentType.includes(
      "multipart/form-data",
    )
  ) {
    const incoming =
      await request.formData();

    const body:
      Record<string, unknown> =
      {};

    [
      "displayName",
      "username",
      "bio",
      "avatarUrl",
      "xUrl",
      "telegramUrl",
      "websiteUrl",
      "nonce",
      "message",
      "signature",
    ].forEach(
      (key) => {
        const value =
          incoming.get(
            key,
          );

        if (
          typeof value ===
          "string"
        ) {
          body[key] =
            value;
        }
      },
    );

    const possibleImage =
      incoming.get(
        "avatar",
      );

    return {
      body,
      image:
        possibleImage instanceof
          File &&
        possibleImage.size >
          0
          ? possibleImage
          : null,
    };
  }

  return {
    body:
      (await request.json()) as Record<
        string,
        unknown
      >,
    image:
      null as File | null,
  };
}

export async function PUT(
  request: NextRequest,
  context: Context,
) {
  try {
    const {
      wallet: rawWallet,
    } =
      await context.params;

    const wallet =
      new PublicKey(
        rawWallet,
      ).toBase58();

    const {
      body,
      image,
    } =
      await readProfileUpdate(
        request,
      );

    const nonce =
      cleanText(
        body.nonce,
        100,
      );

    const message =
      cleanText(
        body.message,
        1000,
      );

    const signature =
      cleanText(
        body.signature,
        500,
      );

    if (
      !nonce ||
      !message ||
      !signature
    ) {
      return NextResponse.json(
        {
          error:
            "Wallet signature is required.",
        },
        {
          status: 401,
        },
      );
    }

    const redisClient =
      getRedis();

    const nonceKey =
      creatorProfileNonceKey(
        wallet,
        nonce,
      );

    const expected =
      await redisClient.get<string>(
        nonceKey,
      );

    if (
      !expected ||
      expected !==
        message
    ) {
      return NextResponse.json(
        {
          error:
            "This edit authorization expired. Please sign again.",
        },
        {
          status: 401,
        },
      );
    }

    if (
      !verifySolanaMessage(
        wallet,
        message,
        signature,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Wallet signature could not be verified.",
        },
        {
          status: 401,
        },
      );
    }

    const username =
      cleanText(
        body.username,
        24,
      ).replace(
        /[^a-zA-Z0-9_]/g,
        "",
      );

    const avatarUrl =
      image
        ? await uploadProfileImage(
            wallet,
            image,
          )
        : cleanUrl(
            body.avatarUrl,
          );

    const profile:
      CreatorProfileMeta = {
      displayName:
        cleanText(
          body.displayName,
          50,
        ),
      username,
      bio:
        cleanText(
          body.bio,
          280,
        ),
      avatarUrl,
      xUrl:
        cleanUrl(
          body.xUrl,
        ),
      telegramUrl:
        cleanUrl(
          body.telegramUrl,
        ),
      websiteUrl:
        cleanUrl(
          body.websiteUrl,
        ),
      updatedAt:
        new Date().toISOString(),
    };

    await redisClient.set(
      creatorProfileKey(
        wallet,
      ),
      profile,
    );

    await redisClient.del(
      nonceKey,
    );

    return NextResponse.json({
      ok:
        true,
      network:
        KODIAK_NETWORK,
      profile,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof
          Error
            ? error.message
            : "Unable to update creator profile.",
      },
      {
        status: 500,
      },
    );
  }
}
