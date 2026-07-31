import { getPdaPlatformVault } from "@raydium-io/raydium-sdk-v2";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  clusterApiUrl,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  type ParsedTransactionWithMeta,
  type VersionedTransactionResponse,
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

const SUCCESS_FUND_TRANSFERRED_LAMPORTS_KEY =
  "kodiak:admin:revenue:success-fund-transferred-lamports:v1";

const SUCCESS_FUND_LAST_TRANSFER_SIGNATURE_KEY =
  "kodiak:admin:revenue:success-fund-last-transfer-signature:v1";

const SUCCESS_FUND_TRANSFER_SIGNATURE_PREFIX =
  "kodiak:admin:revenue:success-fund-transfer-signature:v1:";

const DEFAULT_PLATFORM_ID =
  "D33yYxh4JRtdeyLq7sFD8MzSjdtUa3uNFsSk39QHY8yT";

const CREATOR_SUCCESS_FUND_WALLET =
  "EJeXJ7Bf6nyJ2p4i7kR8Wyfdmi3JgpdU3iDRMCzZheWG";

const CREATOR_SUCCESS_FUND_BPS = 500;
const BPS_DENOMINATOR = 10_000;

function solFromLamports(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

function splitRevenueLamports(totalLamports: number) {
  const creatorSuccessFundLamports = Math.floor(
    (totalLamports * CREATOR_SUCCESS_FUND_BPS) / BPS_DENOMINATOR,
  );

  const kodiakOperatingLamports =
    totalLamports - creatorSuccessFundLamports;

  return {
    creatorSuccessFundLamports,
    creatorSuccessFundSol: solFromLamports(creatorSuccessFundLamports),
    kodiakOperatingLamports,
    kodiakOperatingSol: solFromLamports(kodiakOperatingLamports),
  };
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function getTransactionWithRetry(
  connection: Connection,
  signature: string,
): Promise<VersionedTransactionResponse | null> {
  const attempts = 12;
  const delayMs = 1250;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const transaction =
      await connection.getTransaction(
        signature,
        {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        },
      );

    if (transaction) {
      return transaction;
    }

    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }

  return null;
}

async function getParsedTransactionWithRetry(
  connection: Connection,
  signature: string,
): Promise<ParsedTransactionWithMeta | null> {
  const attempts = 12;
  const delayMs = 1250;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const transaction =
      await connection.getParsedTransaction(
        signature,
        {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        },
      );

    if (transaction) {
      return transaction;
    }

    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }

  return null;
}

async function buildRevenueSummary() {
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

  const creatorSuccessFundTransferredLamports =
    Number(
      (await redis.get<number | string>(
        SUCCESS_FUND_TRANSFERRED_LAMPORTS_KEY,
      )) ?? 0,
    );

  const lastCreatorSuccessFundTransferSignature =
    (await redis.get<string>(
      SUCCESS_FUND_LAST_TRANSFER_SIGNATURE_KEY,
    )) ?? undefined;

  const lifetimeSplit =
    splitRevenueLamports(claimedLamports);

  const pendingCreatorSuccessFundLamports =
    Math.max(
      lifetimeSplit.creatorSuccessFundLamports -
        creatorSuccessFundTransferredLamports,
      0,
    );

  return {
    claimedLamports,
    claimedSol:
      solFromLamports(claimedLamports),

    creatorSuccessFundPercent: 5,
    creatorSuccessFundLamports:
      lifetimeSplit.creatorSuccessFundLamports,
    creatorSuccessFundSol:
      lifetimeSplit.creatorSuccessFundSol,

    creatorSuccessFundTransferredLamports,
    creatorSuccessFundTransferredSol:
      solFromLamports(
        creatorSuccessFundTransferredLamports,
      ),

    pendingCreatorSuccessFundLamports,
    pendingCreatorSuccessFundSol:
      solFromLamports(
        pendingCreatorSuccessFundLamports,
      ),

    creatorSuccessFundWallet:
      CREATOR_SUCCESS_FUND_WALLET,
    lastCreatorSuccessFundTransferSignature,

    kodiakOperatingPercent: 95,
    kodiakOperatingLamports:
      lifetimeSplit.kodiakOperatingLamports,
    kodiakOperatingSol:
      lifetimeSplit.kodiakOperatingSol,

    claimCount,
    lastClaimSignature,
    updatedAt,
  };
}

export async function GET() {
  try {
    return NextResponse.json(
      await buildRevenueSummary(),
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
        await getTransactionWithRetry(
          connection,
          signature,
        );

      if (!transaction) {
        throw new Error(
          "The Devnet transaction is confirmed by the wallet but has not reached Kodiak's verification RPC yet. Please wait a moment and try again.",
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

      const claimSplit =
        splitRevenueLamports(claimedLamports);

      const lifetimeSplit =
        splitRevenueLamports(
          Number(totalClaimedLamports),
        );

      const transferredLamports =
        Number(
          (await redis.get<number | string>(
            SUCCESS_FUND_TRANSFERRED_LAMPORTS_KEY,
          )) ?? 0,
        );

      const pendingCreatorSuccessFundLamports =
        Math.max(
          lifetimeSplit.creatorSuccessFundLamports -
            transferredLamports,
          0,
        );

      return NextResponse.json({
        recorded: true,
        signature,

        claimedLamports,
        claimedSol:
          solFromLamports(
            claimedLamports,
          ),

        creatorSuccessFundPercent: 5,
        claimCreatorSuccessFundLamports:
          claimSplit.creatorSuccessFundLamports,
        claimCreatorSuccessFundSol:
          claimSplit.creatorSuccessFundSol,
        claimKodiakOperatingLamports:
          claimSplit.kodiakOperatingLamports,
        claimKodiakOperatingSol:
          claimSplit.kodiakOperatingSol,

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

        totalCreatorSuccessFundLamports:
          lifetimeSplit.creatorSuccessFundLamports,
        totalCreatorSuccessFundSol:
          lifetimeSplit.creatorSuccessFundSol,

        creatorSuccessFundTransferredLamports:
          transferredLamports,
        creatorSuccessFundTransferredSol:
          solFromLamports(
            transferredLamports,
          ),

        pendingCreatorSuccessFundLamports,
        pendingCreatorSuccessFundSol:
          solFromLamports(
            pendingCreatorSuccessFundLamports,
          ),

        totalKodiakOperatingLamports:
          lifetimeSplit.kodiakOperatingLamports,
        totalKodiakOperatingSol:
          lifetimeSplit.kodiakOperatingSol,

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

export async function PATCH(
  request: NextRequest,
) {
  const redis = getRedis();

  try {
    const body = (await request.json()) as {
      signature?: string;
    };

    const signature =
      typeof body.signature === "string"
        ? body.signature.trim()
        : "";

    if (signature.length < 40) {
      return NextResponse.json(
        {
          error:
            "A valid Success Fund transfer signature is required.",
        },
        { status: 400 },
      );
    }

    const dedupeKey =
      `${SUCCESS_FUND_TRANSFER_SIGNATURE_PREFIX}${signature}`;

    const existing =
      await redis.get<string>(dedupeKey);

    if (existing === "recorded") {
      return NextResponse.json({
        recorded: true,
        ...(await buildRevenueSummary()),
      });
    }

    const lock = await redis.set(
      dedupeKey,
      "processing",
      { nx: true },
    );

    if (!lock && !existing) {
      return NextResponse.json(
        {
          error:
            "This Success Fund transfer is already being processed.",
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
        await getParsedTransactionWithRetry(
          connection,
          signature,
        );

      if (!transaction) {
        throw new Error(
          "The Success Fund transfer has not reached Kodiak's Devnet verification RPC yet. Please wait a moment and try again.",
        );
      }

      if (
        !transaction.meta ||
        transaction.meta.err
      ) {
        throw new Error(
          "The Success Fund transfer was not a successful Devnet transaction.",
        );
      }

      const authorizedSigner =
        transaction.transaction.message.accountKeys.find(
          (account) =>
            account.signer &&
            isKodiakAdminWallet(
              account.pubkey.toBase58(),
            ),
        );

      if (!authorizedSigner) {
        return NextResponse.json(
          {
            error:
              "The Success Fund transfer was not signed by an authorized Kodiak admin wallet.",
          },
          { status: 403 },
        );
      }

      let transferredLamports = 0;

      for (
        const instruction of
        transaction.transaction.message.instructions
      ) {
        if (
          "parsed" in instruction &&
          instruction.program === "system"
        ) {
          const parsed =
            instruction.parsed as {
              type?: string;
              info?: {
                source?: string;
                destination?: string;
                lamports?: number;
              };
            };

          if (
            parsed.type === "transfer" &&
            parsed.info?.source ===
              authorizedSigner.pubkey.toBase58() &&
            parsed.info?.destination ===
              CREATOR_SUCCESS_FUND_WALLET &&
            typeof parsed.info?.lamports === "number" &&
            parsed.info.lamports > 0
          ) {
            transferredLamports +=
              parsed.info.lamports;
          }
        }
      }

      if (transferredLamports <= 0) {
        throw new Error(
          "No SOL transfer to Kodiak's Creator Success Fund wallet was found in this transaction.",
        );
      }

      const summaryBefore =
        await buildRevenueSummary();

      if (
        transferredLamports >
        summaryBefore.pendingCreatorSuccessFundLamports
      ) {
        throw new Error(
          "The transfer amount is larger than Kodiak's pending Creator Success Fund balance.",
        );
      }

      const totalTransferredLamports =
        await redis.incrby(
          SUCCESS_FUND_TRANSFERRED_LAMPORTS_KEY,
          transferredLamports,
        );

      await redis.set(
        SUCCESS_FUND_LAST_TRANSFER_SIGNATURE_KEY,
        signature,
      );

      await redis.set(
        dedupeKey,
        "recorded",
      );

      const updatedAt =
        Math.floor(Date.now() / 1000);

      await redis.set(
        UPDATED_AT_KEY,
        updatedAt,
      );

      return NextResponse.json({
        recorded: true,
        transferSignature: signature,
        transferredLamports,
        transferredSol:
          solFromLamports(
            transferredLamports,
          ),
        totalTransferredLamports:
          Number(totalTransferredLamports),
        totalTransferredSol:
          solFromLamports(
            Number(totalTransferredLamports),
          ),
        ...(await buildRevenueSummary()),
      });
    } catch (error) {
      await redis.del(dedupeKey);
      throw error;
    }
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to verify and record the Creator Success Fund transfer.",
      },
      { status: 500 },
    );
  }
}
