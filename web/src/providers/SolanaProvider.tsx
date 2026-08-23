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
   * The native redirect is important for the Capacitor app:
   * wallet -> approve/sign -> kodiak:// -> Kodiak app.
   *
   * The normal HTTPS metadata URL remains Kodiak's public web origin so
   * browser wallet verification and the existing website remain unchanged.
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
          redirect: {
            native:
              "kodiak://",
            universal:
              KODIAK_APP_URL,
          },
        } as any,
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
          new PhantomWalletAdapter(),
          new SolflareWalletAdapter(),
          new CoinbaseWalletAdapter(),

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
