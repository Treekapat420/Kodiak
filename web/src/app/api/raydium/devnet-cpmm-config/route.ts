import { NextResponse } from "next/server";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function collectConfigIds(value: unknown, output: Set<string>) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectConfigIds(item, output));
    return;
  }

  if (!isRecord(value)) return;

  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();

    if (
      typeof item === "string" &&
      (normalizedKey === "id" ||
        normalizedKey === "configid" ||
        normalizedKey === "config_id" ||
        normalizedKey === "pubkey")
    ) {
      output.add(item);
    } else {
      collectConfigIds(item, output);
    }
  }
}

export async function GET() {
  try {
    const response = await fetch(
      "https://api-v3-devnet.raydium.io/main/cpmm-config",
      { cache: "no-store" },
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: `Raydium returned HTTP ${response.status}`, configIds: [] },
        { status: 502 },
      );
    }

    const payload: unknown = await response.json();
    const configIds = new Set<string>();
    collectConfigIds(payload, configIds);

    return NextResponse.json({
      configIds: Array.from(configIds),
      source: "Raydium Devnet CPMM config API",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to fetch CPMM configs",
        configIds: [],
      },
      { status: 500 },
    );
  }
}
