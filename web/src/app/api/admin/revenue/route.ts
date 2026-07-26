import { getPdaPlatformVault } from "@raydium-io/raydium-sdk-v2";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  clusterApiUrl,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import { NextRequest, NextResponse } from "next/server";

import { isKodiakAdminWallet } from "@/lib/admin";
import { DEVNET_LAUNCHPAD_PROGRAM_ID } from "@/lib/raydium/devnet";
import { getRedis } from "@/lib/server/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIG_KEY = "kodiak:config:v1";

const CLAIMED_LAMPORTS_KEY =
  "kodiak:admin:revenue:claimed-lamports:v2";

const CLAIM_COUNT_KEY =
  "kodiak:admin:revenue:claim-count:v2";

const LAST_SIGNATURE_KEY =
  "kodiak:admin:revenue:last-signature:v2";

const UPDATED_AT_KEY =
  "kodiak:admin:revenue:updated-at:v2";

const CLAIM_SIGNATURE_PREFIX =
  "kodiak:admin:revenue:claim-signature:v2:";

const DEFAULT_PLATFORM_ID =
  "D33yYxh4JRtdeyLq7sFD8MzSjdtUa3uNFsSk39QHY8yT";

function solFromLamports(
  lamports: number,
): number {
  return lamports / LAMPORTS_PER_SOL;
}

async function getPlatformId(): Promise<PublicKey> {
  const redis = getRedis();

  const config =
    await redis.get<Record<string, unknown>>(
      CONFIG_KEY,
    );

  const platformId =
    typeof config?.platformId === "string"
      ? config.platformId
      : DEFAULT_PLATFORM_ID;

  return new PublicKey(platformId);
}

export async function GET() {
  try {
    const redis = getRedis();

    const claimedLamports =
      Number(
        (await redis.get<number | string>(
          CLAIMED_LAMPORTS_KEY,
        )) ?? 0,
      );

    const claimCount =
      Number(
        (await redis.get<number | string>(
          CLAIM_COUNT_KEY,
        )) ?? 0,
      );

    const lastClaimSignature =
      (await redis.get<string>(
        LAST_SIGNATURE_KEY,
      )) ?? undefined;

    const updatedAt =
      Number(
        (await redis.get<number | string>(
          UPDATED_AT_KEY,
        )) ?? 0,
      ) || undefined;

    return NextResponse.json({
      claimedLamports,
      claimedSol:
        solFromLamports(claimedLamports),
      claimCount,
      lastClaimSignature,
      updatedAt,
    });
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
  const redis = getRedis();

  let signature = "";

  try {
    const body = (await request.json()) as {
      signature?: string;
    };

    signature =
      typeof body.signature === "string"
        ? body.signature.trim()
        : "";

    if (signature.length < 40) {
      return NextResponse.json(
        {
          error:
            "A valid Solana transaction signature is required.",
        },
        { status: 400 },
      );
    }

    const dedupeKey =
      `${CLAIM_SIGNATURE_PREFIX}${signature}`;

    const existing =
      await redis.get<string>(dedupeKey);

    if (existing) {
      return NextResponse.json(
        {
          error:
            "This platform claim has already been recorded.",
        },
        { status: 409 },
      );
    }

    const lock = await redis.set(
      dedupeKey,
      "processing",
      { nx: true },
    );

    if (!lock) {
      return NextResponse.json(
        {
          error:
            "This platform claim is already being processed.",
        },
        { status: 409 },
      );
    }

    try {
      const connection = new Connection(
        clusterApiUrl("devnet"),
        "confirmed",
      );

      const transaction =
        await connection.getTransaction(
          signature,
          {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          },
        );

      if (!transaction) {
        throw new Error(
          "The Devnet transaction could not be found.",
        );
      }

      if (
        !transaction.meta ||
        transaction.meta.err
      ) {
        throw new Error(
          "The transaction was not a successful Devnet transaction.",
        );
      }

      const message =
        transaction.transaction.message;

      const requiredSignatures =
        message.header.numRequiredSignatures;

      const signerKeys =
        message.staticAccountKeys.slice(
          0,
          requiredSignatures,
        );

      const authorizedSigner =
        signerKeys.find((key) =>
          isKodiakAdminWallet(
            key.toBase58(),
          ),
        );

      if (!authorizedSigner) {
        return NextResponse.json(
          {
            error:
              "The transaction was not signed by an authorized Kodiak admin wallet.",
          },
          { status: 403 },
        );
      }

      const platformId =
        await getPlatformId();

      const platformVault =
        getPdaPlatformVault(
          DEVNET_LAUNCHPAD_PROGRAM_ID,
          platformId,
          NATIVE_MINT,
        ).publicKey;

      const accountKeys =
        message.getAccountKeys({
          accountKeysFromLookups:
            transaction.meta
              .loadedAddresses ?? undefined,
        });

      let platformVaultIndex = -1;

      for (
        let index = 0;
        index < accountKeys.length;
        index += 1
      ) {
        const key = accountKeys.get(index);

        if (
          key &&
          key.equals(platformVault)
        ) {
          platformVaultIndex = index;
          break;
        }
      }

      if (platformVaultIndex < 0) {
        throw new Error(
          "The transaction does not contain Kodiak's Raydium platform-fee vault.",
        );
      }

      const mint =
        NATIVE_MINT.toBase58();

      const pre =
        transaction.meta.preTokenBalances?.find(
          (balance) =>
            balance.accountIndex ===
              platformVaultIndex &&
            balance.mint === mint,
        );

      const post =
        transaction.meta.postTokenBalances?.find(
          (balance) =>
            balance.accountIndex ===
              platformVaultIndex &&
            balance.mint === mint,
        );

      const preAmount =
        BigInt(
          pre?.uiTokenAmount.amount ?? "0",
        );

      const postAmount =
        BigInt(
          post?.uiTokenAmount.amount ?? "0",
        );

      const claimed =
        preAmount - postAmount;

      if (claimed <= BigInt(0)) {
        throw new Error(
          "No positive Kodiak platform-fee withdrawal was found in this transaction.",
        );
      }

      const claimedLamports =
        Number(claimed);

      if (
        !Number.isSafeInteger(
          claimedLamports,
        )
      ) {
        throw new Error(
          "Claim amount is too large to record safely.",
        );
      }

      const totalClaimedLamports =
        await redis.incrby(
          CLAIMED_LAMPORTS_KEY,
          claimedLamports,
        );

      const claimCount =
        await redis.incr(
          CLAIM_COUNT_KEY,
        );

      const updatedAt =
        Math.floor(Date.now() / 1000);

      await redis.set(
        LAST_SIGNATURE_KEY,
        signature,
      );

      await redis.set(
        UPDATED_AT_KEY,
        updatedAt,
      );

      await redis.set(
        dedupeKey,
        "recorded",
      );

      return NextResponse.json({
        recorded: true,

        signature,

        claimedLamports,
        claimedSol:
          solFromLamports(
            claimedLamports,
          ),

        totalClaimedLamports:
          Number(
            totalClaimedLamports,
          ),

        totalClaimedSol:
          solFromLamports(
            Number(
              totalClaimedLamports,
            ),
          ),

        claimCount:
          Number(claimCount),

        updatedAt,
      });
    } catch (error) {
      await redis.del(
        `${CLAIM_SIGNATURE_PREFIX}${signature}`,
      );

      throw error;
    }
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to verify and record Kodiak platform revenue.",
      },
      { status: 500 },
    );
  }
}
