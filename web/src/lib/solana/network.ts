import { clusterApiUrl } from "@solana/web3.js";

export type KodiakNetwork = "devnet" | "mainnet";

function readNetwork(): KodiakNetwork {
  const value =
    process.env.NEXT_PUBLIC_SOLANA_NETWORK?.trim().toLowerCase();

  if (
    value === "mainnet" ||
    value === "mainnet-beta"
  ) {
    return "mainnet";
  }

  return "devnet";
}

export const KODIAK_NETWORK: KodiakNetwork = readNetwork();

export const KODIAK_IS_DEVNET =
  KODIAK_NETWORK === "devnet";

export const KODIAK_IS_MAINNET =
  KODIAK_NETWORK === "mainnet";

function configuredRpcUrl() {
  if (KODIAK_IS_MAINNET) {
    return (
      process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL?.trim() ||
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
      clusterApiUrl("mainnet-beta")
    );
  }

  return (
    process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
    clusterApiUrl("devnet")
  );
}

export const KODIAK_RPC_URL = configuredRpcUrl();

export const KODIAK_EXPLORER_CLUSTER_QUERY =
  KODIAK_IS_DEVNET ? "?cluster=devnet" : "";

export function kodiakExplorerAddressUrl(
  address: string,
) {
  return `https://explorer.solana.com/address/${address}${KODIAK_EXPLORER_CLUSTER_QUERY}`;
}

export function kodiakExplorerTransactionUrl(
  signature: string,
) {
  return `https://explorer.solana.com/tx/${signature}${KODIAK_EXPLORER_CLUSTER_QUERY}`;
}

export function kodiakNetworkLabel() {
  return KODIAK_IS_DEVNET ? "Devnet" : "Mainnet";
}
