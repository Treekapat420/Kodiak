export const KODIAK_ADMIN_WALLETS = new Set([
  "Af1JaQiQjpkmcpexDXQXH81XN97GHYhnJ3nnAf9R8iU9",
]);

export function isKodiakAdminWallet(
  wallet: string | null | undefined,
): boolean {
  if (!wallet) return false;

  return KODIAK_ADMIN_WALLETS.has(wallet);
}
