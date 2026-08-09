import { NextResponse } from "next/server";

import {
  KODIAK_IS_DEVNET,
  KODIAK_NETWORK,
} from "@/lib/solana/network";
import { getRedis } from "@/lib/server/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIG_KEY_PREFIX = "kodiak:config:v2";

const DEVNET_PLATFORM_ID =
  "D33yYxh4JRtdeyLq7sFD8MzSjdtUa3uNFsSk39QHY8yT";

function getPlatformId() {
  if (KODIAK_IS_DEVNET) {
    return (
      process.env.KODIAK_DEVNET_PLATFORM_ID?.trim() ||
      process.env.NEXT_PUBLIC_KODIAK_DEVNET_PLATFORM_ID?.trim() ||
      DEVNET_PLATFORM_ID
    );
  }

  const mainnetPlatformId =
    process.env.KODIAK_MAINNET_PLATFORM_ID?.trim() ||
    process.env.NEXT_PUBLIC_KODIAK_MAINNET_PLATFORM_ID?.trim();

  if (!mainnetPlatformId) {
    throw new Error(
      "Kodiak Mainnet PlatformConfig is not configured. Set KODIAK_MAINNET_PLATFORM_ID before enabling Mainnet.",
    );
  }

  return mainnetPlatformId;
}

function getConfigKey() {
  return `${CONFIG_KEY_PREFIX}:${KODIAK_NETWORK}`;
}

function buildDefaultConfig() {
  return {
    version: 2,
    network: KODIAK_NETWORK,
    platformId: getPlatformId(),
    tradingFeeBps: 120,
    infrastructureFeeBps: 25,
    regularCreatorFeeBps: 45,
    regularKodiakFeeBps: 50,
    foundingCreatorFeeBps: 50,
    foundingKodiakFeeBps: 45,
    foundingCreatorLimit: 100,
    creatorSuccessFundPercentOfKodiakRevenue: 5,
    foundingProgramEnabled: true,
    maintenanceMode: false,
  };
}

export async function GET() {
  try {
    const redis = getRedis();
    const configKey = getConfigKey();
    const defaultConfig = buildDefaultConfig();

    const stored =
      await redis.get<Record<string, unknown>>(configKey);

    if (!stored) {
      await redis.set(configKey, defaultConfig);

      return NextResponse.json(defaultConfig);
    }

    return NextResponse.json({
      ...defaultConfig,
      ...stored,
      network: KODIAK_NETWORK,
      platformId: defaultConfig.platformId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load Kodiak configuration.",
      },
      { status: 503 },
    );
  }
}
