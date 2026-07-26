import { NextResponse } from "next/server";
import { getRedis } from "@/lib/server/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIG_KEY = "kodiak:config:v1";

const defaultConfig = {
  version: 1,
  network: "devnet",
  platformId: "D33yYxh4JRtdeyLq7sFD8MzSjdtUa3uNFsSk39QHY8yT",
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

export async function GET() {
  try {
    const redis = getRedis();
    const stored = await redis.get<Record<string, unknown>>(CONFIG_KEY);

    if (!stored) {
      await redis.set(CONFIG_KEY, defaultConfig);
      return NextResponse.json(defaultConfig);
    }

    return NextResponse.json({
      ...defaultConfig,
      ...stored,
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
