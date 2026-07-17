#!/usr/bin/env bash
set -euo pipefail

echo "🐻 Repairing Kodiak wallet integration..."

if [ ! -d "web" ]; then
  echo "Error: run this from /workspaces/Kodiak."
  exit 1
fi

cat > web/src/components/wallet/KodiakWalletButton.tsx <<'EOF'
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
EOF

cat > web/src/hooks/useSolBalance.ts <<'EOF'
"use client";

import { useCallback, useEffect, useState } from "react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

export function useSolBalance() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!publicKey) {
      return;
    }

    setLoading(true);

    try {
      const lamports = await connection.getBalance(publicKey, "confirmed");
      setBalance(lamports / LAMPORTS_PER_SOL);
    } catch (error) {
      console.error("Unable to load SOL balance:", error);
      setBalance(null);
    } finally {
      setLoading(false);
    }
  }, [connection, publicKey]);

  useEffect(() => {
    if (!publicKey) {
      return;
    }

    void refresh();
  }, [publicKey, refresh]);

  return { balance, loading, refresh };
}
EOF

cd web
npm run lint
npm run build
cd ..

git add .
git commit -m "fix wallet integration lint errors" || true

echo ""
echo "✅ Wallet repair complete."
echo "Refresh Kodiak and test Connect Wallet."
