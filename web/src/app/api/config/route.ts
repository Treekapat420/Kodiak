import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

import { KODIAK_FEES } from "@/lib/fees";

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

const MAINNET_PLATFORM_ID =
  "5d63yX2vRpyS2BPFwJJB15tMmctWCKwiKychEjP3gy4W";

function requireValidPublicKey(
  value: string,
  label: string,
) {
  try {
    const publicKey =
      new PublicKey(value);

    if (
      publicKey.toBase58() !==
      value
    ) {
      throw new Error(
        `${label} is not a canonical Solana public key.`,
      );
    }

    return value;
  } catch {
    throw new Error(
      `${label} is not a valid Solana public key.`,
    );
  }
}

function getPlatformId() {
  if (KODIAK_IS_DEVNET) {
    const devnetPlatformId =
      process.env.KODIAK_DEVNET_PLATFORM_ID?.trim() ||
      process.env.NEXT_PUBLIC_KODIAK_DEVNET_PLATFORM_ID?.trim() ||
      DEVNET_PLATFORM_ID;

    return requireValidPublicKey(
      devnetPlatformId,
      "Kodiak Devnet PlatformConfig",
    );
  }

  /*
   * Mainnet uses Kodiak's already-created and verified PlatformConfig as the
   * final fallback. Environment variables may override it, but any supplied
   * value must still be a valid canonical Solana public key.
   */
  const mainnetPlatformId =
    process.env.KODIAK_MAINNET_PLATFORM_ID?.trim() ||
    process.env.NEXT_PUBLIC_KODIAK_MAINNET_PLATFORM_ID?.trim() ||
    MAINNET_PLATFORM_ID;

  return requireValidPublicKey(
    mainnetPlatformId,
    "Kodiak Mainnet PlatformConfig",
  );
}

function getConfigKey() {
  return `${CONFIG_KEY_PREFIX}:${KODIAK_NETWORK}`;
}

function buildDefaultConfig() {
  return {
    version: 2,
    network: KODIAK_NETWORK,
    platformId: getPlatformId(),

    /*
     * Display/accounting metadata for Kodiak's current LaunchLab fee model:
     * 0.25% Raydium base + 0.45% creator + 0.50% Kodiak = 1.20% total.
     */
    tradingFeeBps: KODIAK_FEES.totalCurveBps,
    infrastructureFeeBps: KODIAK_FEES.raydiumProtocolBps,
    regularCreatorFeeBps: KODIAK_FEES.creatorCurveBps,
    regularKodiakFeeBps: KODIAK_FEES.kodiakPlatformBps,

    // Founding Creator status is a program/badge benefit only.
    // It does not alter the on-chain LaunchLab fee split.
    foundingCreatorFeeBps: KODIAK_FEES.creatorCurveBps,
    foundingKodiakFeeBps: KODIAK_FEES.kodiakPlatformBps,
    foundingCreatorLimit: 100,

    creatorSuccessFundPercentOfKodiakRevenue: KODIAK_FEES.creatorSuccessFundPercent,
    foundingProgramEnabled: true,
    maintenanceMode: false,
  };
}

export async function GET() {
  try {
    const redis = getRedis();
    const configKey =
      getConfigKey();
    const defaultConfig =
      buildDefaultConfig();

    const stored =
      await redis.get<
        Record<string, unknown>
      >(configKey);

    if (!stored) {
      await redis.set(
        configKey,
        defaultConfig,
      );

      return NextResponse.json(
        defaultConfig,
      );
    }

    /*
     * Stored feature/config values may be reused, but network and PlatformConfig
     * are always derived from the active Kodiak deployment. This prevents stale
     * Devnet Redis data from overriding Mainnet identity after the final switch.
     */
    return NextResponse.json({
      ...defaultConfig,
      ...stored,

      // Fee metadata is code-defined and cannot be overwritten by stale Redis.
      tradingFeeBps:
        KODIAK_FEES.totalCurveBps,
      infrastructureFeeBps:
        KODIAK_FEES.raydiumProtocolBps,
      regularCreatorFeeBps:
        KODIAK_FEES.creatorCurveBps,
      regularKodiakFeeBps:
        KODIAK_FEES.kodiakPlatformBps,
      foundingCreatorFeeBps:
        KODIAK_FEES.creatorCurveBps,
      foundingKodiakFeeBps:
        KODIAK_FEES.kodiakPlatformBps,
      creatorSuccessFundPercentOfKodiakRevenue:
        KODIAK_FEES.creatorSuccessFundPercent,

      network:
        KODIAK_NETWORK,
      platformId:
        defaultConfig.platformId,
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
