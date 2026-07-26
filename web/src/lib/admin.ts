export const KODIAK_ADMIN_WALLETS = new Set([
  "HFo47xm7JmnyseZM6sa9YBuLE2V7VqSRtfsxrBNj91NX",
]);

export function isKodiakAdminWallet(
  wallet: string | null | undefined,
): boolean {
  if (!wallet) return false;

  return KODIAK_ADMIN_WALLETS.has(wallet);
}
