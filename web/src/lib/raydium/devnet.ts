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

const MAINNET_ENABLED =
  process.env.NEXT_PUBLIC_KODIAK_MAINNET_ENABLED?.trim().toLowerCase() ===
  "true";

function assertKodiakRaydiumReady() {
  if (KODIAK_IS_MAINNET && !MAINNET_ENABLED) {
    throw new Error(
      "Kodiak Mainnet transactions are still locked. " +
        "Set NEXT_PUBLIC_KODIAK_MAINNET_ENABLED=true only after the " +
        "Mainnet PlatformConfig, migration configuration, production RPC, " +
        "admin wallets, and final end-to-end tests have been verified.",
    );
  }
}

function raydiumUrlConfig() {
  if (!KODIAK_IS_DEVNET) {
    return {};
  }

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
    cluster: KODIAK_NETWORK,
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: "confirmed",
    ...raydiumUrlConfig(),
  });
}

/*
 * Compatibility exports:
 *
 * Existing Kodiak pages still import the old Devnet names. Keep these
 * aliases temporarily so we can migrate each caller safely and test after
 * every replacement instead of changing the entire application at once.
 *
 * Both aliases now route through the shared network-aware implementation.
 */
export const loadDevnetRaydium =
  loadKodiakRaydium;

export const DEVNET_LAUNCHPAD_PROGRAM_ID =
  KODIAK_LAUNCHPAD_PROGRAM_ID;
