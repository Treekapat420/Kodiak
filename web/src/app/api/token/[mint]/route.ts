import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

import {
  KODIAK_IS_DEVNET,
  KODIAK_NETWORK,
} from "@/lib/solana/network";
import { getRedis } from "@/lib/server/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LaunchRecord = {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  signature: string;
  network?: string;
  createdAt: string;
  verifiedAt: string;
};

function launchKey(
  mint: string,
) {
  /*
   * Preserve the existing Devnet key exactly so all previously registered
   * Kodiak test launches continue to load without migration.
   *
   * Mainnet uses a separate namespace when it is eventually enabled.
   */
  return KODIAK_IS_DEVNET
    ? `kodiak:launch:${mint}`
    : `kodiak:mainnet:launch:${mint}`;
}

export async function GET(
  _request: NextRequest,
  context: {
    params: Promise<{
      mint: string;
    }>;
  },
) {
  try {
    const {
      mint: rawMint,
    } =
      await context.params;

    const mint =
      new PublicKey(
        rawMint,
      ).toBase58();

    const launch =
      await getRedis().get<LaunchRecord>(
        launchKey(mint),
      );

    if (!launch) {
      return NextResponse.json(
        {
          error:
            "This token is not registered with Kodiak on the active network.",
          network:
            KODIAK_NETWORK,
        },
        {
          status: 404,
        },
      );
    }

    if (
      launch.network &&
      launch.network !==
        KODIAK_NETWORK
    ) {
      return NextResponse.json(
        {
          error:
            `This token is registered for ${launch.network}, not ${KODIAK_NETWORK}.`,
          network:
            KODIAK_NETWORK,
        },
        {
          status: 409,
        },
      );
    }

    return NextResponse.json({
      network:
        KODIAK_NETWORK,
      launch: {
        ...launch,
        network:
          launch.network ??
          KODIAK_NETWORK,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof
          Error
            ? error.message
            : "Unable to load the token.",
        network:
          KODIAK_NETWORK,
      },
      {
        status: 400,
      },
    );
  }
}
