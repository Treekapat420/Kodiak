import { NextRequest, NextResponse } from "next/server";

import { getRedis } from "@/lib/server/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REVENUE_KEY = "kodiak:admin:revenue:v1";

type RevenueRecord = {
  claimedSol: number;
  lastClaimSignature?: string;
  updatedAt?: number;
};

const emptyRecord: RevenueRecord = {
  claimedSol: 0,
};

export async function GET() {
  try {
    const redis = getRedis();

    const stored =
      await redis.get<RevenueRecord>(REVENUE_KEY);

    return NextResponse.json(
      stored ?? emptyRecord,
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load Kodiak revenue accounting.",
      },
      { status: 503 },
    );
  }
}

export async function POST(
  request: NextRequest,
) {
  try {
    const body = (await request.json()) as {
      claimedSol?: number;
      signature?: string;
    };

    const claimedSol =
      Number(body.claimedSol ?? 0);

    if (
      !Number.isFinite(claimedSol) ||
      claimedSol <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "A positive claimed SOL amount is required.",
        },
        { status: 400 },
      );
    }

    const redis = getRedis();

    const existing =
      (await redis.get<RevenueRecord>(
        REVENUE_KEY,
      )) ?? emptyRecord;

    const next: RevenueRecord = {
      claimedSol:
        Number(existing.claimedSol || 0) +
        claimedSol,
      lastClaimSignature:
        body.signature ??
        existing.lastClaimSignature,
      updatedAt: Math.floor(
        Date.now() / 1000,
      ),
    };

    await redis.set(REVENUE_KEY, next);

    return NextResponse.json(next);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to update Kodiak revenue accounting.",
      },
      { status: 500 },
    );
  }
}
