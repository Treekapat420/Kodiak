import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

import {
  KODIAK_IS_DEVNET,
} from "@/lib/solana/network";

export const dynamic = "force-dynamic";

const RAYDIUM_CPMM_CREATOR_FEE_HOST =
  KODIAK_IS_DEVNET
    ? "https://temp-api-v1-devnet.raydium.io"
    : "https://temp-api-v1.raydium.io";

export async function GET(
  request: NextRequest,
) {
  const wallet =
    request.nextUrl.searchParams
      .get("wallet")
      ?.trim();

  if (!wallet) {
    return NextResponse.json(
      {
        error:
          "wallet is required",
      },
      {
        status: 400,
      },
    );
  }

  try {
    new PublicKey(wallet);
  } catch {
    return NextResponse.json(
      {
        error:
          "wallet must be a valid Solana public key",
      },
      {
        status: 400,
      },
    );
  }

  try {
    const response =
      await fetch(
        `${RAYDIUM_CPMM_CREATOR_FEE_HOST}/cp-creator-fee?wallet=${encodeURIComponent(
          wallet,
        )}`,
        {
          cache: "no-store",
          headers: {
            accept:
              "application/json",
          },
        },
      );

    const text =
      await response.text();

    let payload:
      | unknown
      | null =
      null;

    try {
      payload =
        JSON.parse(text);
    } catch {
      payload = null;
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            `Raydium CPMM creator-fee lookup failed with HTTP ${response.status}.`,
          upstream:
            payload,
        },
        {
          status: 502,
        },
      );
    }

    if (
      !payload ||
      typeof payload !==
        "object"
    ) {
      return NextResponse.json(
        {
          error:
            "Raydium returned an invalid CPMM creator-fee response.",
        },
        {
          status: 502,
        },
      );
    }

    return NextResponse.json(
      payload,
      {
        headers: {
          "Cache-Control":
            "no-store",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to reach Raydium's CPMM creator-fee service.",
      },
      {
        status: 502,
      },
    );
  }
}
