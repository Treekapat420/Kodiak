import {
  DEV_API_URLS,
  DEVNET_PROGRAM_ID,
  LAUNCHPAD_PROGRAM,
  Raydium,
} from "@raydium-io/raydium-sdk-v2";
import type {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  KODIAK_IS_DEVNET,
  KODIAK_IS_MAINNET,
  KODIAK_MAINNET_ENABLED,
  KODIAK_NETWORK,
} from "@/lib/solana/network";

type WalletTransaction =
  Transaction | VersionedTransaction;

type SignTransaction = <
  T extends WalletTransaction,
>(
  transaction: T,
) => Promise<T>;

type SignAllTransactions = <
  T extends WalletTransaction,
>(
  transactions: T[],
) => Promise<T[]>;

type LoadKodiakRaydiumParams = {
  connection: Connection;
  owner: PublicKey;
  signTransaction: SignTransaction;
  signAllTransactions: SignAllTransactions;
};

function assertKodiakRaydiumReady() {
  /*
   * Use the shared network module as Kodiak's single source of truth.
   * network.ts already requires BOTH:
   *
   * NEXT_PUBLIC_SOLANA_NETWORK=mainnet
   * NEXT_PUBLIC_KODIAK_MAINNET_ENABLED=true
   *
   * before KODIAK_IS_MAINNET can become true.
   */
  if (
    KODIAK_IS_MAINNET &&
    !KODIAK_MAINNET_ENABLED
  ) {
    throw new Error(
      "Kodiak Mainnet transactions are still locked. " +
        "Enable Mainnet only after the PlatformConfig, CPMM migration target, " +
        "production RPC, authority wallets, and final end-to-end checks are verified.",
    );
  }
}

function raydiumUrlConfig() {
  if (!KODIAK_IS_DEVNET) {
    return {};
  }

  /*
   * Raydium Devnet uses its dedicated API hosts.
   * Mainnet intentionally falls through to the SDK's production defaults.
   */
  return {
    urlConfigs: {
      ...DEV_API_URLS,
      BASE_HOST:
        "https://api-v3-devnet.raydium.io",
      OWNER_BASE_HOST:
        "https://owner-v1-devnet.raydium.io",
      SWAP_HOST:
        "https://transaction-v1-devnet.raydium.io",
      CPMM_LOCK:
        "https://dynamic-ipfs-devnet.raydium.io/lock/cpmm/position",
    },
  };
}

export const KODIAK_LAUNCHPAD_PROGRAM_ID =
  KODIAK_IS_DEVNET
    ? DEVNET_PROGRAM_ID.LAUNCHPAD_PROGRAM
    : LAUNCHPAD_PROGRAM;

export async function loadKodiakRaydium({
  connection,
  owner,
  signTransaction,
  signAllTransactions,
}: LoadKodiakRaydiumParams) {
  assertKodiakRaydiumReady();

  const walletFriendlySignAllTransactions:
    SignAllTransactions = async <
      T extends WalletTransaction,
    >(
      transactions: T[],
    ): Promise<T[]> => {
      if (transactions.length === 1) {
        const signedTransaction =
          await signTransaction(
            transactions[0],
          );

        return [signedTransaction];
      }

      return signAllTransactions(
        transactions,
      );
    };

  return Raydium.load({
    connection,
    owner,
    signAllTransactions:
      walletFriendlySignAllTransactions,
    cluster:
      KODIAK_NETWORK,
    disableFeatureCheck:
      true,
    disableLoadToken:
      true,
    blockhashCommitment:
      "confirmed",
    ...raydiumUrlConfig(),
  });
}

/*
 * Compatibility exports:
 *
 * Older Kodiak files may still import the historical Devnet names.
 * Keep these aliases until every caller has been migrated. They now route
 * through the shared network-aware implementation, so they do not force
 * Devnet behavior.
 */
export const loadDevnetRaydium =
  loadKodiakRaydium;

export const DEVNET_LAUNCHPAD_PROGRAM_ID =
  KODIAK_LAUNCHPAD_PROGRAM_ID;
