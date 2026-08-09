import { clusterApiUrl } from "@solana/web3.js";

export type KodiakNetwork = "devnet" | "mainnet";

export const KODIAK_MAINNET_CPMM_CONFIG_ID =
  "D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2";

function requestedNetwork(): KodiakNetwork {
  const value =
    process.env.NEXT_PUBLIC_SOLANA_NETWORK
      ?.trim()
      .toLowerCase();

  if (
    value === "mainnet" ||
    value === "mainnet-beta"
  ) {
    return "mainnet";
  }

  return "devnet";
}

function mainnetExplicitlyEnabled() {
  return (
    process.env.NEXT_PUBLIC_KODIAK_MAINNET_ENABLED
      ?.trim()
      .toLowerCase() === "true"
  );
}

export const KODIAK_REQUESTED_NETWORK =
  requestedNetwork();

export const KODIAK_MAINNET_ENABLED =
  mainnetExplicitlyEnabled();

/*
 * Fail closed:
 *
 * Asking for Mainnet is not enough by itself. Kodiak only becomes Mainnet
 * when BOTH of these are true:
 *
 * NEXT_PUBLIC_SOLANA_NETWORK=mainnet
 * NEXT_PUBLIC_KODIAK_MAINNET_ENABLED=true
 *
 * This protects the production site from an accidental network-variable edit.
 */
export const KODIAK_NETWORK: KodiakNetwork =
  KODIAK_REQUESTED_NETWORK === "mainnet" &&
  KODIAK_MAINNET_ENABLED
    ? "mainnet"
    : "devnet";

export const KODIAK_IS_DEVNET =
  KODIAK_NETWORK === "devnet";

export const KODIAK_IS_MAINNET =
  KODIAK_NETWORK === "mainnet";

export const KODIAK_MAINNET_REQUESTED_BUT_LOCKED =
  KODIAK_REQUESTED_NETWORK === "mainnet" &&
  !KODIAK_MAINNET_ENABLED;

function configuredRpcUrl() {
  if (KODIAK_IS_MAINNET) {
    const mainnetRpc =
      process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL
        ?.trim();

    if (!mainnetRpc) {
      throw new Error(
        "Kodiak Mainnet is enabled, but NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL is missing. Mainnet will not use a fallback RPC.",
      );
    }

    return mainnetRpc;
  }

  return (
    process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
    clusterApiUrl("devnet")
  );
}

export const KODIAK_RPC_URL =
  configuredRpcUrl();

export const KODIAK_EXPLORER_CLUSTER_QUERY =
  KODIAK_IS_DEVNET
    ? "?cluster=devnet"
    : "";

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
  return KODIAK_IS_DEVNET
    ? "Devnet"
    : "Mainnet";
}
