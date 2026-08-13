"use client";

import {
  useMemo,
} from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import {
  WalletModalProvider,
} from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
} from "@solana/wallet-adapter-phantom";
import {
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-solflare";
import {
  CoinbaseWalletAdapter,
} from "@solana/wallet-adapter-coinbase";
import {
  useWrappedReownAdapter,
} from "@jup-ag/jup-mobile-adapter";

import {
  KODIAK_RPC_URL,
} from "@/lib/solana/network";

const REOWN_PROJECT_ID =
  "49b136392a67f80809fc2b9bea96b9f8";

const KODIAK_APP_URL =
  "https://kodiak-tt65.vercel.app";

const KODIAK_ICON_URL =
  `${KODIAK_APP_URL}/kodiak-logo.jpeg`;

export function SolanaProvider({
  children,
}: Readonly<{
  children:
    React.ReactNode;
}>) {
  const endpoint =
    useMemo(
      () =>
        KODIAK_RPC_URL,
      [],
    );

  /*
   * Jupiter Mobile uses Reown / WalletConnect underneath.
   *
   * Keep this isolated inside Kodiak's existing Solana provider so the rest
   * of the application can continue using useWallet(), WalletProvider,
   * signTransaction(), signAllTransactions(), signMessage(), etc.
   */
  const {
    reownAdapter,
    jupiterAdapter,
  } =
    useWrappedReownAdapter({
      appKitOptions: {
        metadata: {
          name:
            "Kodiak",
          description:
            "Kodiak Solana launchpad",
          url:
            KODIAK_APP_URL,
          icons: [
            KODIAK_ICON_URL,
          ],
        },
        projectId:
          REOWN_PROJECT_ID,
        features: {
          analytics:
            false,
          socials: [],
          email:
            false,
        },
        /*
         * Kodiak keeps its own wallet selector.
         * Reown is used only as the transport required by Jupiter Mobile.
         */
        enableWallets:
          false,
      },
    });

  const wallets =
    useMemo(
      () =>
        [
          /*
           * Existing Kodiak adapters.
           * Phantom's current Safari -> Phantom handoff remains intact.
           */
          new PhantomWalletAdapter(),
          new SolflareWalletAdapter(),
          new CoinbaseWalletAdapter(),

          /*
           * WalletConnect/Reown transport plus the explicit Jupiter Mobile
           * adapter. Filter defensively because these adapters initialize
           * from a React hook and may briefly be unavailable.
           */
          reownAdapter,
          jupiterAdapter,
        ].filter(
          (
            adapter,
          ) =>
            Boolean(
              adapter &&
                adapter.name &&
                adapter.icon,
            ),
        ),
      [
        reownAdapter,
        jupiterAdapter,
      ],
    );

  return (
    <ConnectionProvider
      endpoint={
        endpoint
      }
    >
      <WalletProvider
        wallets={
          wallets
        }
        autoConnect
      >
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
