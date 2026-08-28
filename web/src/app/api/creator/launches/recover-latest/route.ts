import { NextRequest, NextResponse } from "next/server";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import {
  getPdaLaunchpadPoolId,
  LaunchpadPool,
} from "@raydium-io/raydium-sdk-v2";

import {
  KODIAK_LAUNCHPAD_PROGRAM_ID,
} from "@/lib/raydium/devnet";
import {
  KODIAK_IS_DEVNET,
  KODIAK_IS_MAINNET,
  KODIAK_NETWORK,
  KODIAK_RPC_URL,
} from "@/lib/solana/network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePublicKey(value: string) {
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

function serverRpcUrl() {
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

function getConnection() {
  return new Connection(serverRpcUrl(), "confirmed");
}

function sleep(ms: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms),
  );
}

function looksRateLimited(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  return (
    message.includes("429") ||
    message.toLowerCase().includes("rate limit")
  );
}

async function withRpcRetry<T>(
  operation: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;

  for (
    let attempt = 0;
    attempt < attempts;
    attempt += 1
  ) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (
        !looksRateLimited(error) ||
        attempt === attempts - 1
      ) {
        throw error;
      }

      await sleep(
        650 * (attempt + 1),
      );
    }
  }

  throw lastError;
}

async function getKodiakPlatformId() {
  const value =
    KODIAK_IS_DEVNET
      ? (
          process.env.KODIAK_DEVNET_PLATFORM_ID?.trim() ||
          process.env.NEXT_PUBLIC_KODIAK_DEVNET_PLATFORM_ID?.trim()
        )
      : (
          process.env.KODIAK_MAINNET_PLATFORM_ID?.trim() ||
          process.env.NEXT_PUBLIC_KODIAK_MAINNET_PLATFORM_ID?.trim()
        );

  if (!value) {
    throw new Error(
      `Kodiak's ${KODIAK_NETWORK} PlatformConfig is not configured on the server.`,
    );
  }

  const platformId =
    parsePublicKey(value);

  if (!platformId) {
    throw new Error(
      `Kodiak's configured ${KODIAK_NETWORK} PlatformConfig is invalid.`,
    );
  }

  return platformId;
}

export async function GET(
  request: NextRequest,
) {
  try {
    const creatorValue =
      request.nextUrl.searchParams
        .get("creator")
        ?.trim() ?? "";

    const creator =
      parsePublicKey(
        creatorValue,
      );

    if (!creator) {
      return NextResponse.json(
        {
          error:
            "A valid creator wallet is required.",
        },
        {
          status: 400,
        },
      );
    }

    const connection =
      getConnection();

    const signatures =
      await withRpcRetry(
        () =>
          connection.getSignaturesForAddress(
            creator,
            {
              limit: 8,
            },
            "confirmed",
          ),
      );

    const kodiakPlatformId =
      await getKodiakPlatformId();

    for (
      const signatureInfo of signatures
    ) {
      if (signatureInfo.err) {
        continue;
      }

      const transaction =
        await withRpcRetry(
          () =>
            connection.getParsedTransaction(
              signatureInfo.signature,
              {
                commitment:
                  "confirmed",
                maxSupportedTransactionVersion: 0,
              },
            ),
        );

      if (
        !transaction ||
        transaction.meta?.err
      ) {
        continue;
      }

      const accountKeys =
        transaction.transaction.message.accountKeys;

      const creatorSigned =
        accountKeys.some(
          (entry) =>
            entry.signer &&
            entry.pubkey.equals(
              creator,
            ),
        );

      const invokesLaunchLab =
        accountKeys.some(
          (entry) =>
            entry.pubkey.equals(
              KODIAK_LAUNCHPAD_PROGRAM_ID,
            ),
        );

      if (
        !creatorSigned ||
        !invokesLaunchLab
      ) {
        continue;
      }

      const postTokenMints =
        Array.from(
          new Set(
            (
              transaction.meta
                ?.postTokenBalances ??
              []
            )
              .map(
                (balance) =>
                  balance.mint,
              )
              .filter(
                (mint) =>
                  mint &&
                  mint !==
                    NATIVE_MINT.toBase58(),
              ),
          ),
        );

      for (
        const mintValue of postTokenMints
      ) {
        const mint =
          parsePublicKey(
            mintValue,
          );

        if (!mint) {
          continue;
        }

        /*
         * A later buy/sell can also invoke LaunchLab and mention the token mint.
         * Recovery must only accept the actual creation transaction. The mint
         * account is created in that transaction, so its pre-balance is zero
         * and its post-balance is funded.
         */
        const mintAccountIndex =
          accountKeys.findIndex(
            (entry) =>
              entry.pubkey.equals(
                mint,
              ),
          );

        if (
          mintAccountIndex < 0
        ) {
          continue;
        }

        const preLamports =
          transaction.meta
            ?.preBalances[
              mintAccountIndex
            ] ?? 0;

        const postLamports =
          transaction.meta
            ?.postBalances[
              mintAccountIndex
            ] ?? 0;

        if (
          preLamports !== 0 ||
          postLamports <= 0
        ) {
          continue;
        }

        const poolId =
          getPdaLaunchpadPoolId(
            KODIAK_LAUNCHPAD_PROGRAM_ID,
            mint,
            NATIVE_MINT,
          ).publicKey;

        const poolAccount =
          await withRpcRetry(
            () =>
              connection.getAccountInfo(
                poolId,
                "confirmed",
              ),
          );

        if (!poolAccount) {
          continue;
        }

        let poolInfo:
          ReturnType<
            typeof LaunchpadPool.decode
          >;

        try {
          poolInfo =
            LaunchpadPool.decode(
              poolAccount.data,
            );
        } catch {
          continue;
        }

        if (
          !poolInfo.mintA.equals(
            mint,
          ) ||
          !poolInfo.mintB.equals(
            NATIVE_MINT,
          ) ||
          !poolInfo.platformId.equals(
            kodiakPlatformId,
          )
        ) {
          continue;
        }

        const createdAt =
          typeof transaction.blockTime ===
          "number"
            ? new Date(
                transaction.blockTime *
                  1000,
              ).toISOString()
            : new Date().toISOString();

        return NextResponse.json({
          network:
            KODIAK_NETWORK,
          candidate: {
            mint:
              mint.toBase58(),
            signature:
              signatureInfo.signature,
            createdAt,
            launchpadPool:
              poolId.toBase58(),
          },
        });
      }
    }

    return NextResponse.json(
      {
        error:
          "No recent successful Kodiak LaunchLab creation transaction was found for this creator wallet.",
      },
      {
        status: 404,
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to recover a recent launch.",
      },
      {
        status:
          looksRateLimited(
            error,
          )
            ? 429
            : 503,
      },
    );
  }
}
