import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  PublicKey,
} from "@solana/web3.js";

import {
  getHolderRewardStatus,
  isOfficialKodiakRewardsMint,
} from "@/lib/holder-rewards";

import {
  finalizeOnchainClaim,
  getOnchainRewardsStatus,
  prepareOnchainClaim,
} from "@/lib/onchain-holder-rewards";

import {
  KODIAK_NETWORK,
} from "@/lib/solana/network";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    mint: string;
  }>;
};

type RequestBody = {
  action?:
    | "prepare"
    | "finalize";
  wallet?: string;
  signature?: string;
};

function canonical(
  value: string,
  label: string,
) {
  const key =
    new PublicKey(value);

  if (key.toBase58() !== value) {
    throw new Error(
      `${label} is not a canonical Solana public key.`,
    );
  }

  return key.toBase58();
}

export async function GET(
  request: NextRequest,
  context: Context,
) {
  try {
    const {
      mint: rawMint,
    } = await context.params;

    const mint = canonical(
      rawMint,
      "Token mint",
    );

    const walletRaw =
      request.nextUrl.searchParams
        .get("wallet")
        ?.trim() ?? "";

    const wallet = walletRaw
      ? canonical(
          walletRaw,
          "Wallet",
        )
      : undefined;

    const [
      status,
      onchain,
    ] = await Promise.all([
      getHolderRewardStatus(
        mint,
        wallet,
      ),
      getOnchainRewardsStatus(
        mint,
        wallet,
      ),
    ]);

    const pendingLamports =
      "claimableLamports" in status
        ? Number(
            status.claimableLamports ?? 0,
          )
        : 0;

    const pendingSol =
      "claimableSol" in status
        ? Number(
            status.claimableSol ?? 0,
          )
        : 0;

    const activeLamports =
      Number(
        onchain.activeClaimLamports ?? 0,
      );

    const activeSol =
      Number(
        onchain.activeClaimSol ?? 0,
      );

    return NextResponse.json(
      {
        ...status,
        ...onchain,

        // Claimable includes both rewards that have
        // already been published on-chain and any
        // newer rewards waiting for the next auto
        // epoch publisher pass.
        claimableLamports:
          pendingLamports +
          activeLamports,

        claimableSol:
          pendingSol +
          activeSol,
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
          error instanceof Error
            ? error.message
            : "Unable to load SOL rewards.",
        network:
          KODIAK_NETWORK,
      },
      {
        status: 400,
      },
    );
  }
}

export async function POST(
  request: NextRequest,
  context: Context,
) {
  try {
    const {
      mint: rawMint,
    } = await context.params;

    const mint = canonical(
      rawMint,
      "Token mint",
    );

    const body =
      (await request.json()) as
        RequestBody;

    const wallet = canonical(
      body.wallet?.trim() ?? "",
      "Wallet",
    );

    if (
      !isOfficialKodiakRewardsMint(
        mint,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "SOL rewards are only enabled for the official Devnet $KODIAK token.",
        },
        {
          status: 403,
        },
      );
    }

    if (
      body.action === "prepare"
    ) {
      return NextResponse.json({
        ok: true,
        ...(await prepareOnchainClaim(
          mint,
          wallet,
        )),
        network:
          KODIAK_NETWORK,
      });
    }

    if (
      body.action === "finalize"
    ) {
      const signature =
        body.signature?.trim() ?? "";

      if (!signature) {
        throw new Error(
          "Missing claim transaction signature.",
        );
      }

      return NextResponse.json({
        ok: true,
        ...(await finalizeOnchainClaim(
          mint,
          wallet,
          signature,
        )),
        network:
          KODIAK_NETWORK,
      });
    }

    return NextResponse.json(
      {
        error:
          "Invalid rewards action.",
      },
      {
        status: 400,
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to process SOL rewards.",
        network:
          KODIAK_NETWORK,
      },
      {
        status: 500,
      },
    );
  }
}
