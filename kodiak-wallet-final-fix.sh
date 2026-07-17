#!/usr/bin/env bash
set -euo pipefail

echo "🐻 Applying final SOL balance fix..."

if [ ! -d "web" ]; then
  echo "Error: run this from /workspaces/Kodiak."
  exit 1
fi

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
    if (!publicKey) return;

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
    if (!publicKey) return;

    let cancelled = false;

    const loadBalance = async () => {
      try {
        const lamports = await connection.getBalance(publicKey, "confirmed");
        if (!cancelled) {
          setBalance(lamports / LAMPORTS_PER_SOL);
        }
      } catch (error) {
        console.error("Unable to load SOL balance:", error);
        if (!cancelled) {
          setBalance(null);
        }
      }
    };

    void loadBalance();

    return () => {
      cancelled = true;
    };
  }, [connection, publicKey]);

  return { balance, loading, refresh };
}
EOF

cd web
npm run lint
npm run build
cd ..

git add web/src/hooks/useSolBalance.ts
git commit -m "fix SOL balance effect" || true

echo ""
echo "✅ Final wallet fix complete."
echo "Refresh Kodiak and test Connect Wallet."
