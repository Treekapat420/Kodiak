import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
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

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ mint: string }> },
) {
  try {
    const { mint: rawMint } = await context.params;
    const mint = new PublicKey(rawMint).toBase58();
    const launch = await getRedis().get<LaunchRecord>(
      `kodiak:launch:${mint}`,
    );

    if (!launch) {
      return NextResponse.json(
        { error: "This token is not registered with Kodiak." },
        { status: 404 },
      );
    }

    return NextResponse.json({ launch });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load the token.",
      },
      { status: 400 },
    );
  }
}
