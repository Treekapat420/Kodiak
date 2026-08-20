import { NextRequest, NextResponse } from "next/server";
import { NATIVE_MINT } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  CREATE_CPMM_POOL_PROGRAM,
  DEVNET_PROGRAM_ID,
  getCpmmPdaPoolId,
  getPdaLaunchpadPoolId,
  LaunchpadPool,
  PlatformConfig,
} from "@raydium-io/raydium-sdk-v2";

import { KODIAK_LAUNCHPAD_PROGRAM_ID } from "@/lib/raydium/devnet";
import { verifySolanaMessage } from "@/lib/server/verify-solana-signature";
import { isKodiakAdminWallet } from "@/lib/admin";
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
  params: Promise<{ mint: string }>;
};

const DEVNET_PLATFORM_ID = "D33yYxh4JRtdeyLq7sFD8MzSjdtUa3uNFsSk39QHY8yT";
const MAINNET_PLATFORM_ID = "5d63yX2vRpyS2BPFwJJB15tMmctWCKwiKychEjP3gy4W";

function serverRpcUrl() {
  if (KODIAK_IS_MAINNET) {
    return process.env.SOLANA_MAINNET_RPC_URL?.trim() || KODIAK_RPC_URL;
  }

  return (
    process.env.SOLANA_DEVNET_RPC_URL?.trim() ||
    process.env.SOLANA_RPC_URL?.trim() ||
    KODIAK_RPC_URL
  );
}

const connection = new Connection(serverRpcUrl(), "confirmed");

function configuredPlatformId() {
  const value = KODIAK_IS_DEVNET
    ? process.env.KODIAK_DEVNET_PLATFORM_ID?.trim() ||
      process.env.NEXT_PUBLIC_KODIAK_DEVNET_PLATFORM_ID?.trim() ||
      DEVNET_PLATFORM_ID
    : process.env.KODIAK_MAINNET_PLATFORM_ID?.trim() ||
      process.env.NEXT_PUBLIC_KODIAK_MAINNET_PLATFORM_ID?.trim() ||
      MAINNET_PLATFORM_ID;

  return new PublicKey(value);
}

function statusLabel(status: number) {
  if (status === 0) return "active";
  if (status === 1) return "graduated";
  if (status === 2) return "cancelled";
  return "unknown";
}

function progressBps(realB: bigint, targetB: bigint) {
  if (targetB <= BigInt(0)) return 0;

  const value = Number((realB * BigInt(10000)) / targetB);
  return Math.max(0, Math.min(10000, value));
}

function lamportsToSolString(value: bigint) {
  const LAMPORTS_PER_SOL = BigInt(1000000000);

  const whole = value / LAMPORTS_PER_SOL;

  const fraction = (value % LAMPORTS_PER_SOL)
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");

  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function bnLikeToString(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "object" && "toString" in value) {
    try {
      return String((value as { toString(): string }).toString());
    } catch {
      return null;
    }
  }
  return null;
}

async function recentSignatures(address: PublicKey, limit = 12) {
  const signatures = await connection.getSignaturesForAddress(address, { limit }, "confirmed");

  const detailed = await Promise.all(
    signatures.map(async (item) => {
      let logs: string[] | null = null;

      // Pull logs for failed transactions and the three newest successful ones.
      const shouldLoadLogs = Boolean(item.err) || signatures.indexOf(item) < 3;
      if (shouldLoadLogs) {
        try {
          const tx = await connection.getTransaction(item.signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          });
          logs = tx?.meta?.logMessages ?? null;
        } catch {
          logs = null;
        }
      }

      return {
        signature: item.signature,
        slot: item.slot,
        blockTime: item.blockTime,
        confirmationStatus: item.confirmationStatus ?? null,
        err: item.err ?? null,
        memo: item.memo ?? null,
        logs,
      };
    }),
  );

  return detailed;
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const { mint: rawMint } = await context.params;

    const wallet = request.headers.get("x-kodiak-admin-wallet")?.trim() || "";
    const issuedAt = request.headers.get("x-kodiak-admin-issued-at")?.trim() || "";
    const signature = request.headers.get("x-kodiak-admin-signature")?.trim() || "";

    if (!isKodiakAdminWallet(wallet) || !issuedAt || !signature) {
      return NextResponse.json({ error: "Unauthorized admin request." }, { status: 401 });
    }

    const issuedMs = Date.parse(issuedAt);
    if (!Number.isFinite(issuedMs) || Math.abs(Date.now() - issuedMs) > 2 * 60 * 1000) {
      return NextResponse.json({ error: "Admin authorization expired. Run diagnostics again." }, { status: 401 });
    }

    const authMessage = `Kodiak Admin Graduation Diagnostics\nWallet: ${wallet}\nMint: ${rawMint}\nIssued At: ${issuedAt}`;
    if (!verifySolanaMessage(wallet, authMessage, signature)) {
      return NextResponse.json({ error: "Invalid admin wallet signature." }, { status: 401 });
    }
    const mintA = new PublicKey(rawMint);

    const launchpadPoolId = getPdaLaunchpadPoolId(
      KODIAK_LAUNCHPAD_PROGRAM_ID,
      mintA,
      NATIVE_MINT,
    ).publicKey;

    const poolContext = await connection.getAccountInfoAndContext(
      launchpadPoolId,
      "confirmed",
    );
    const poolAccount = poolContext.value;

    if (!poolAccount) {
      return NextResponse.json(
        {
          error: "Kodiak could not find this token's LaunchLab pool on the active network.",
          network: KODIAK_NETWORK,
          mint: mintA.toBase58(),
          launchpadPoolId: launchpadPoolId.toBase58(),
        },
        { status: 404 },
      );
    }

    if (!poolAccount.owner.equals(KODIAK_LAUNCHPAD_PROGRAM_ID)) {
      throw new Error("The derived LaunchLab pool is not owned by the active Raydium LaunchLab program.");
    }

    const poolInfo = LaunchpadPool.decode(poolAccount.data);
    const kodiakPlatformId = configuredPlatformId();
    const belongsToKodiak = poolInfo.platformId.equals(kodiakPlatformId);

    const rawStatus = Number(poolInfo.status);
    const realB = BigInt(poolInfo.realB.toString());
    const targetB = BigInt(poolInfo.totalFundRaisingB.toString());
    const thresholdReached = realB >= targetB;
    const bps = progressBps(realB, targetB);

    const platformAccount = await connection.getAccountInfo(poolInfo.platformId, "confirmed");
    let cpConfigId: PublicKey | null = null;
    let platformFeeRate: string | null = null;
    let creatorFeeRate: string | null = null;
    let platformOwnerMatches = false;

    if (platformAccount) {
      platformOwnerMatches = platformAccount.owner.equals(KODIAK_LAUNCHPAD_PROGRAM_ID);
      if (platformOwnerMatches) {
        const platformInfo = PlatformConfig.decode(platformAccount.data) as unknown as {
          cpConfigId?: PublicKey;
          feeRate?: unknown;
          creatorFeeRate?: unknown;
        };
        cpConfigId = platformInfo.cpConfigId instanceof PublicKey ? platformInfo.cpConfigId : null;
        platformFeeRate = bnLikeToString(platformInfo.feeRate);
        creatorFeeRate = bnLikeToString(platformInfo.creatorFeeRate);
      }
    }

    const cpmmProgramId = KODIAK_IS_DEVNET
      ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM
      : CREATE_CPMM_POOL_PROGRAM;

    const cpmmCandidates: Array<{
      address: string;
      exists: boolean;
      ownerMatches: boolean;
    }> = [];

    if (cpConfigId) {
      const candidateKeys = [
        getCpmmPdaPoolId(cpmmProgramId, cpConfigId, poolInfo.mintA, poolInfo.mintB).publicKey,
        getCpmmPdaPoolId(cpmmProgramId, cpConfigId, poolInfo.mintB, poolInfo.mintA).publicKey,
      ];

      for (const candidate of candidateKeys) {
        if (cpmmCandidates.some((item) => item.address === candidate.toBase58())) continue;
        const account = await connection.getAccountInfo(candidate, "confirmed");
        cpmmCandidates.push({
          address: candidate.toBase58(),
          exists: Boolean(account),
          ownerMatches: Boolean(account?.owner.equals(cpmmProgramId)),
        });
      }
    }

    const cpmmPoolId =
      cpmmCandidates.find((item) => item.exists && item.ownerMatches)?.address ?? null;

    const launchpadTransactions = await recentSignatures(launchpadPoolId);
    const cpmmTransactions = cpmmPoolId
      ? await recentSignatures(new PublicKey(cpmmPoolId), 8)
      : [];

    const mainnetCpmmMatches =
      !KODIAK_IS_MAINNET || cpConfigId?.toBase58() === KODIAK_MAINNET_CPMM_CONFIG_ID;

    const checks = [
      {
        id: "pool-owner",
        label: "LaunchLab pool owner",
        pass: poolAccount.owner.equals(KODIAK_LAUNCHPAD_PROGRAM_ID),
        detail: poolAccount.owner.toBase58(),
      },
      {
        id: "platform",
        label: "Kodiak PlatformConfig",
        pass: belongsToKodiak,
        detail: poolInfo.platformId.toBase58(),
      },
      {
        id: "migration-type",
        label: "CPMM migration type",
        pass: Number(poolInfo.migrateType) === 1,
        detail: `raw migrateType=${Number(poolInfo.migrateType)}`,
      },
      {
        id: "platform-owner",
        label: "PlatformConfig owner",
        pass: platformOwnerMatches,
        detail: platformAccount?.owner.toBase58() ?? "account missing",
      },
      {
        id: "cpmm-config",
        label: KODIAK_IS_MAINNET ? "Verified Mainnet CPMM config" : "CPMM config available",
        pass: Boolean(cpConfigId) && mainnetCpmmMatches,
        detail: cpConfigId?.toBase58() ?? "not available",
      },
      {
        id: "graduation-transition",
        label: "Graduation transition",
        pass: rawStatus === 0 ? !thresholdReached : rawStatus === 1,
        detail:
          rawStatus === 1
            ? "LaunchLab marks the token graduated."
            : thresholdReached
              ? "Target reached; waiting for LaunchLab to mark graduation."
              : "Bonding curve is still active.",
      },
      {
        id: "cpmm-pool",
        label: "Graduated CPMM pool",
        pass: rawStatus !== 1 || Boolean(cpmmPoolId),
        detail:
          rawStatus !== 1
            ? "Not required until graduation."
            : cpmmPoolId || "Graduated, but the expected CPMM pool is not discoverable yet.",
      },
    ];

    return NextResponse.json(
      {
        network: KODIAK_NETWORK,
        generatedAt: new Date().toISOString(),
        mint: mintA.toBase58(),
        state: statusLabel(rawStatus),
        rawStatus,
        launchpadPoolId: launchpadPoolId.toBase58(),
        launchpadProgramId: KODIAK_LAUNCHPAD_PROGRAM_ID.toBase58(),
        launchpadAccountSlot: poolContext.context.slot,
        launchpadAccountLamports: poolAccount.lamports,
        platformId: poolInfo.platformId.toBase58(),
        configuredKodiakPlatformId: kodiakPlatformId.toBase58(),
        belongsToKodiak,
        migrateTypeRaw: Number(poolInfo.migrateType),
        migrateType: Number(poolInfo.migrateType) === 1 ? "cpmm" : "unknown",
        mintA: poolInfo.mintA.toBase58(),
        mintB: poolInfo.mintB.toBase58(),
        bonding: {
          quoteCollectedRaw: realB.toString(),
          quoteCollectedSol: lamportsToSolString(realB),
          quoteTargetRaw: targetB.toString(),
          quoteTargetSol: lamportsToSolString(targetB),
          remainingRaw: realB >= targetB ? "0" : (targetB - realB).toString(),
          remainingSol: realB >= targetB ? "0" : lamportsToSolString(targetB - realB),
          progressBps: bps,
          progressPercent: bps / 100,
          thresholdReached,
        },
        platform: {
          accountExists: Boolean(platformAccount),
          ownerMatchesLaunchLab: platformOwnerMatches,
          cpConfigId: cpConfigId?.toBase58() ?? null,
          platformFeeRate,
          creatorFeeRate,
          mainnetCpmmMatches,
        },
        cpmm: {
          programId: cpmmProgramId.toBase58(),
          poolId: cpmmPoolId,
          candidates: cpmmCandidates,
        },
        trading: {
          launchpadActive: rawStatus === 0 && !thresholdReached,
          graduationReady: rawStatus === 0 && thresholdReached,
          graduated: rawStatus === 1,
          cancelled: rawStatus === 2,
          cpmmReady: rawStatus === 1 && Boolean(cpmmPoolId),
        },
        checks,
        transactions: {
          launchpadPool: launchpadTransactions,
          cpmmPool: cpmmTransactions,
        },
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to build graduation diagnostics.",
        network: KODIAK_NETWORK,
      },
      { status: 400 },
    );
  }
}
