import {
  KODIAK_IS_MAINNET,
} from "@/lib/solana/network";

/*
 * Mainnet launches that were used only for Kodiak production testing.
 *
 * Archiving is intentionally keyed by mint address, never by token name or
 * symbol, so an unrelated future launch cannot be hidden accidentally.
 * This affects Kodiak's public/indexed surfaces only; it does not and cannot
 * alter Solana's on-chain history.
 */
const MAINNET_ARCHIVED_MINTS = new Set<string>([
  "GyVcjNWwrLy9fCup5SKUyrqAgJ2c3sKsFtu5vHb8D8hR",
]);

export function isKodiakArchivedMint(
  mint: string | null | undefined,
) {
  if (!KODIAK_IS_MAINNET || !mint) {
    return false;
  }

  return MAINNET_ARCHIVED_MINTS.has(mint);
}
