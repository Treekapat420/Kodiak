import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UnknownRecord =
  Record<string, unknown>;

type MainnetCpmmConfig = {
  id: string;
  index?: number;
  protocolFeeRate?: number;
  tradeFeeRate?: number;
  fundFeeRate?: number;
  createPoolFee?: string;
  creatorFeeRate?: number;
  showWithUI?: boolean;
};

function isRecord(
  value: unknown,
): value is UnknownRecord {
  return (
    typeof value === "object" &&
    value !== null
  );
}

function isPublicKey(
  value: unknown,
): value is string {
  if (
    typeof value !== "string"
  ) {
    return false;
  }

  try {
    return (
      new PublicKey(
        value,
      ).toBase58() ===
      value
    );
  } catch {
    return false;
  }
}

function asFiniteNumber(
  value: unknown,
): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;

  return Number.isFinite(parsed)
    ? parsed
    : undefined;
}

function asString(
  value: unknown,
): string | undefined {
  return typeof value === "string"
    ? value
    : undefined;
}

function asBoolean(
  value: unknown,
): boolean | undefined {
  return typeof value === "boolean"
    ? value
    : undefined;
}

function extractConfigs(
  payload: unknown,
): MainnetCpmmConfig[] {
  if (!isRecord(payload)) {
    return [];
  }

  const data =
    payload.data;

  if (!Array.isArray(data)) {
    return [];
  }

  const configs:
    MainnetCpmmConfig[] = [];

  for (
    const item of data
  ) {
    if (!isRecord(item)) {
      continue;
    }

    const id =
      item.id;

    if (!isPublicKey(id)) {
      continue;
    }

    configs.push({
      id,
      index:
        asFiniteNumber(
          item.index,
        ),
      protocolFeeRate:
        asFiniteNumber(
          item.protocolFeeRate,
        ),
      tradeFeeRate:
        asFiniteNumber(
          item.tradeFeeRate,
        ),
      fundFeeRate:
        asFiniteNumber(
          item.fundFeeRate,
        ),
      createPoolFee:
        asString(
          item.createPoolFee,
        ),
      creatorFeeRate:
        asFiniteNumber(
          item.creatorFeeRate,
        ),
      showWithUI:
        asBoolean(
          item.showWithUI,
        ),
    });
  }

  return configs;
}

export async function GET() {
  try {
    /*
     * Read-only Mainnet discovery endpoint.
     *
     * This route never builds, signs, or submits a Solana transaction.
     * It exists only so Kodiak can inspect Raydium's published Mainnet
     * CPMM configurations while the Mainnet transaction path remains locked.
     */
    const response =
      await fetch(
        "https://api-v3.raydium.io/main/cpmm-config",
        {
          cache:
            "no-store",
          headers: {
            Accept:
              "application/json",
          },
        },
      );

    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            `Raydium returned HTTP ${response.status}.`,
          network:
            "mainnet",
          configs: [],
        },
        {
          status: 502,
        },
      );
    }

    const payload:
      unknown =
      await response.json();

    const configs =
      extractConfigs(
        payload,
      );

    if (
      configs.length ===
      0
    ) {
      return NextResponse.json(
        {
          error:
            "Raydium's Mainnet API did not return any valid CPMM configurations.",
          network:
            "mainnet",
          configs: [],
        },
        {
          status: 502,
        },
      );
    }

    return NextResponse.json(
      {
        network:
          "mainnet",
        configs,
        configIds:
          configs.map(
            (config) =>
              config.id,
          ),
        source:
          "Raydium Mainnet CPMM config API",
        readOnly:
          true,
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
            : "Unable to fetch Mainnet CPMM configurations.",
        network:
          "mainnet",
        configs: [],
      },
      {
        status: 500,
      },
    );
  }
}
