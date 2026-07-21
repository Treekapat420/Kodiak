import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function isPublicKey(value: unknown): value is string {
  if (typeof value !== "string") return false;

  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

function collectPublicKeyConfigs(value: unknown, output: Set<string>) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectPublicKeyConfigs(item, output));
    return;
  }

  if (!isRecord(value)) return;

  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    const isConfigField =
      normalizedKey === "id" ||
      normalizedKey === "configid" ||
      normalizedKey === "config_id" ||
      normalizedKey === "pubkey" ||
      normalizedKey === "address";

    if (isConfigField && isPublicKey(item)) {
      output.add(item);
      continue;
    }

    if (Array.isArray(item) || isRecord(item)) {
      collectPublicKeyConfigs(item, output);
    }
  }
}

export async function GET() {
  try {
    const response = await fetch(
      "https://api-v3-devnet.raydium.io/main/cpmm-config",
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
      },
    );

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `Raydium returned HTTP ${response.status}`,
          configIds: [],
        },
        { status: 502 },
      );
    }

    const payload: unknown = await response.json();
    const configIds = new Set<string>();
    collectPublicKeyConfigs(payload, configIds);

    if (configIds.size === 0) {
      return NextResponse.json(
        {
          error:
            "Raydium's Devnet API did not return a valid CPMM configuration public key.",
          configIds: [],
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      configIds: Array.from(configIds),
      source: "Raydium Devnet CPMM config API",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to fetch CPMM configurations.",
        configIds: [],
      },
      { status: 500 },
    );
  }
}
