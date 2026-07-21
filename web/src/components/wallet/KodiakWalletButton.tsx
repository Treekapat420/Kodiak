"use client";

import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  async () => {
    const walletUi = await import("@solana/wallet-adapter-react-ui");
    return walletUi.WalletMultiButton;
  },
  { ssr: false },
);

export function KodiakWalletButton() {
  return <WalletMultiButton className="kodiak-wallet-button" />;
}
