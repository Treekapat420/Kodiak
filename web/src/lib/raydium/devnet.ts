import {
  DEV_API_URLS,
  DEVNET_PROGRAM_ID,
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

function assertDevnetRaydiumReady() {
  if (!KODIAK_IS_DEVNET) {
    throw new Error(
      "Kodiak Mainnet Raydium configuration is not enabled yet. " +
        "The network layer is Mainnet-aware, but LaunchLab program IDs, " +
        "PlatformConfig, migration configuration, and production RPC settings " +
        "must be verified before Mainnet transactions are allowed.",
    );
  }
}

export async function loadDevnetRaydium({
  connection,
  owner,
  signTransaction,
  signAllTransactions,
}: {
  connection: Connection;
  owner: PublicKey;
  signTransaction: SignTransaction;
  signAllTransactions: SignAllTransactions;
}) {
  assertDevnetRaydiumReady();

  const phantomFriendlySignAllTransactions:
    SignAllTransactions = async <
      T extends WalletTransaction,
    >(
      transactions: T[],
    ): Promise<T[]> => {
      if (transactions.length === 1) {
        const signedTransaction =
          await signTransaction(transactions[0]);

        return [signedTransaction];
      }

      return signAllTransactions(transactions);
    };

  return Raydium.load({
    connection,
    owner,
    signAllTransactions:
      phantomFriendlySignAllTransactions,
    cluster: KODIAK_NETWORK,
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: "confirmed",
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
  });
}

export const DEVNET_LAUNCHPAD_PROGRAM_ID =
  DEVNET_PROGRAM_ID.LAUNCHPAD_PROGRAM;
