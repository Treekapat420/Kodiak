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

type SignAllTransactions = <T extends Transaction | VersionedTransaction>(
  transactions: T[],
) => Promise<T[]>;

export async function loadDevnetRaydium({
  connection,
  owner,
  signAllTransactions,
}: {
  connection: Connection;
  owner: PublicKey;
  signAllTransactions: SignAllTransactions;
}) {
  return Raydium.load({
    connection,
    owner,
    signAllTransactions,
    cluster: "devnet",
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: "confirmed",
    urlConfigs: {
      ...DEV_API_URLS,
      BASE_HOST: "https://api-v3-devnet.raydium.io",
      OWNER_BASE_HOST: "https://owner-v1-devnet.raydium.io",
      SWAP_HOST: "https://transaction-v1-devnet.raydium.io",
      CPMM_LOCK: "https://dynamic-ipfs-devnet.raydium.io/lock/cpmm/position",
    },
  });
}

export const DEVNET_LAUNCHPAD_PROGRAM_ID =
  DEVNET_PROGRAM_ID.LAUNCHPAD_PROGRAM;
