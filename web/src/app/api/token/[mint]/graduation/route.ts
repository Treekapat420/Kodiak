import { NextRequest, NextResponse } from "next/server";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import {
  CREATE_CPMM_POOL_PROGRAM,
  DEVNET_PROGRAM_ID,
  getCpmmPdaPoolId,
  getPdaLaunchpadPoolId,
  LaunchpadPool,
  PlatformConfig,
} from "@raydium-io/raydium-sdk-v2";

import {
  KODIAK_LAUNCHPAD_PROGRAM_ID,
} from "@/lib/raydium/devnet";
import {
  KODIAK_IS_DEVNET,
  KODIAK_IS_MAINNET,
  KODIAK_MAINNET_CPMM_CONFIG_ID,
  KODIAK_NETWORK,
  KODIAK_RPC_URL,
} from "@/lib/solana/network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    mint: string;
  }>;
};

const DEVNET_PLATFORM_ID =
  "D33yYxh4JRtdeyLq7sFD8MzSjdtUa3uNFsSk39QHY8yT";

const MAINNET_PLATFORM_ID =
  "5d63yX2vRpyS2BPFwJJB15tMmctWCKwiKychEjP3gy4W";

function serverRpcUrl() {
  /*
   * Mainnet intentionally does NOT fall back through the generic
   * SOLANA_RPC_URL variable. KODIAK_RPC_URL already fails closed when
   * Mainnet is enabled without a dedicated Mainnet RPC.
   */
  if (KODIAK_IS_MAINNET) {
    return (
      process.env.SOLANA_MAINNET_RPC_URL?.trim() ||
      KODIAK_RPC_URL
    );
  }

  return (
    process.env.SOLANA_DEVNET_RPC_URL?.trim() ||
    process.env.SOLANA_RPC_URL?.trim() ||
    KODIAK_RPC_URL
  );
}

const connection =
  new Connection(
    serverRpcUrl(),
    "confirmed",
  );

function configuredPlatformId() {
  const value =
    KODIAK_IS_DEVNET
      ? (
          process.env.KODIAK_DEVNET_PLATFORM_ID?.trim() ||
          process.env.NEXT_PUBLIC_KODIAK_DEVNET_PLATFORM_ID?.trim() ||
          DEVNET_PLATFORM_ID
        )
      : (
          process.env.KODIAK_MAINNET_PLATFORM_ID?.trim() ||
          process.env.NEXT_PUBLIC_KODIAK_MAINNET_PLATFORM_ID?.trim() ||
          MAINNET_PLATFORM_ID
        );

  return new PublicKey(
    value,
  );
}

function statusLabel(
  status: number,
) {
  if (status === 0) {
    return "active";
  }

  if (status === 1) {
    return "graduated";
  }

  if (status === 2) {
    return "cancelled";
  }

  return "unknown";
}

function progressBps(
  realB: string,
  targetB: string,
) {
  try {
    const real =
      BigInt(realB);

    const target =
      BigInt(targetB);

    if (target <= BigInt(0)) {
      return 0;
    }

    const value =
      Number(
        (real * BigInt(10_000)) /
          target,
      );

    return Math.max(
      0,
      Math.min(
        10_000,
        value,
      ),
    );
  } catch {
    return 0;
  }
}

async function findGraduatedCpmmPool({
  mintA,
  mintB,
  cpConfigId,
}: {
  mintA: PublicKey;
  mintB: PublicKey;
  cpConfigId: PublicKey;
}) {
  const cpmmProgramId =
    KODIAK_IS_DEVNET
      ? DEVNET_PROGRAM_ID
          .CREATE_CPMM_POOL_PROGRAM
      : CREATE_CPMM_POOL_PROGRAM;

  /*
   * CPMM pool PDAs include both mint addresses. Check both orders instead of
   * making assumptions about the order the migration instruction used.
   */
  const candidates =
    [
      getCpmmPdaPoolId(
        cpmmProgramId,
        cpConfigId,
        mintA,
        mintB,
      ).publicKey,
      getCpmmPdaPoolId(
        cpmmProgramId,
        cpConfigId,
        mintB,
        mintA,
      ).publicKey,
    ];

  for (
    const candidate of candidates
  ) {
    const account =
      await connection.getAccountInfo(
        candidate,
        "confirmed",
      );

    if (
      account &&
      account.owner.equals(
        cpmmProgramId,
      )
    ) {
      return candidate;
    }
  }

  return null;
}

export async function GET(
  _request: NextRequest,
  context: Context,
) {
  try {
    const {
      mint: rawMint,
    } =
      await context.params;

    const mintA =
      new PublicKey(
        rawMint,
      );

    const poolId =
      getPdaLaunchpadPoolId(
        KODIAK_LAUNCHPAD_PROGRAM_ID,
        mintA,
        NATIVE_MINT,
      ).publicKey;

    const poolAccount =
      await connection.getAccountInfo(
        poolId,
        "confirmed",
      );

    if (!poolAccount) {
      return NextResponse.json(
        {
          error:
            "Kodiak could not find this token's Raydium LaunchLab pool on the active network.",
          network:
            KODIAK_NETWORK,
          mint:
            mintA.toBase58(),
          launchpadPoolId:
            poolId.toBase58(),
        },
        {
          status: 404,
        },
      );
    }

    if (
      !poolAccount.owner.equals(
        KODIAK_LAUNCHPAD_PROGRAM_ID,
      )
    ) {
      throw new Error(
        "The derived LaunchLab pool account is not owned by the active Raydium LaunchLab program.",
      );
    }

    const poolInfo =
      LaunchpadPool.decode(
        poolAccount.data,
      );

    const kodiakPlatformId =
      configuredPlatformId();

    if (
      !poolInfo.platformId.equals(
        kodiakPlatformId,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "This LaunchLab token does not belong to Kodiak's active PlatformConfig.",
          network:
            KODIAK_NETWORK,
          mint:
            mintA.toBase58(),
          launchpadPoolId:
            poolId.toBase58(),
          platformId:
            poolInfo.platformId.toBase58(),
        },
        {
          status: 403,
        },
      );
    }

    const migrateType =
      Number(
        poolInfo.migrateType,
      );

    if (migrateType !== 1) {
      throw new Error(
        "This Kodiak launch is not configured to migrate to Raydium CPMM.",
      );
    }

    const rawStatus =
      Number(
        poolInfo.status,
      );

    const realB =
      poolInfo.realB.toString();

    const targetB =
      poolInfo.totalFundRaisingB.toString();

    const bondingProgressBps =
      progressBps(
        realB,
        targetB,
      );

    const thresholdReached =
      BigInt(realB) >=
      BigInt(targetB);

    let cpmmPoolId:
      PublicKey | null =
      null;

    let cpConfigId:
      PublicKey | null =
      null;

    if (
      rawStatus === 1 ||
      thresholdReached
    ) {
      const platformAccount =
        await connection.getAccountInfo(
          poolInfo.platformId,
          "confirmed",
        );

      if (!platformAccount) {
        throw new Error(
          "Kodiak's LaunchLab PlatformConfig account was not found on the active network.",
        );
      }

      if (
        !platformAccount.owner.equals(
          KODIAK_LAUNCHPAD_PROGRAM_ID,
        )
      ) {
        throw new Error(
          "Kodiak's PlatformConfig account is not owned by the active Raydium LaunchLab program.",
        );
      }

      const platformInfo =
        PlatformConfig.decode(
          platformAccount.data,
        );

      cpConfigId =
        platformInfo.cpConfigId;

      /*
       * Kodiak's verified Mainnet migration target is Raydium CPMM index 8.
       * Fail closed if the live PlatformConfig ever points somewhere else.
       */
      if (
        KODIAK_IS_MAINNET &&
        cpConfigId.toBase58() !==
          KODIAK_MAINNET_CPMM_CONFIG_ID
      ) {
        throw new Error(
          "Kodiak's Mainnet PlatformConfig no longer points to the verified CPMM index 8 configuration. Graduation trading is locked until this is reviewed.",
        );
      }

      if (rawStatus === 1) {
        cpmmPoolId =
          await findGraduatedCpmmPool({
            mintA:
              poolInfo.mintA,
            mintB:
              poolInfo.mintB,
            cpConfigId,
          });
      }
    }

    const state =
      statusLabel(
        rawStatus,
      );

    return NextResponse.json(
      {
        network:
          KODIAK_NETWORK,
        mint:
          mintA.toBase58(),
        state,
        rawStatus,
        migrateType:
          "cpmm",
        launchpadPoolId:
          poolId.toBase58(),
        platformId:
          poolInfo.platformId.toBase58(),
        cpConfigId:
          cpConfigId?.toBase58() ??
          null,
        cpmmPoolId:
          cpmmPoolId?.toBase58() ??
          null,
        bonding: {
          quoteCollectedRaw:
            realB,
          quoteTargetRaw:
            targetB,
          progressBps:
            bondingProgressBps,
          progressPercent:
            bondingProgressBps /
            100,
          thresholdReached,
        },
        trading: {
          launchpadActive:
            rawStatus === 0 &&
            !thresholdReached,
          graduationReady:
            rawStatus === 0 &&
            thresholdReached,
          graduated:
            rawStatus === 1,
          cancelled:
            rawStatus === 2,
          cpmmReady:
            rawStatus === 1 &&
            Boolean(
              cpmmPoolId,
            ),
        },
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
            : "Unable to read Kodiak graduation state.",
        network:
          KODIAK_NETWORK,
      },
      {
        status: 400,
      },
    );
  }
}
