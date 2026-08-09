"use client";

import Link from "next/link";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

import { KodiakWalletButton } from "@/components/wallet/KodiakWalletButton";
import {
  KODIAK_IS_DEVNET,
  KODIAK_NETWORK,
  kodiakExplorerTransactionUrl,
  kodiakNetworkLabel,
} from "@/lib/solana/network";

type SavedLaunch = {
  mint?: string;
  signatures?: string[];
  name?: string;
  symbol?: string;
  createdAt?: string;
  network?: string;
};

type LaunchRecord = {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  signature: string;
  createdAt: string;
  network?: string;
};

type FoundingCreator = {
  isFoundingCreator: boolean;
  number: number | null;
  label: string | null;
};

type FeeConfig = {
  tradingFeeBps: number;
  infrastructureFeeBps: number;
  regularCreatorFeeBps: number;
  regularKodiakFeeBps: number;
  foundingCreatorFeeBps: number;
  foundingKodiakFeeBps: number;
  foundingCreatorLimit: number;
  creatorSuccessFundPercentOfKodiakRevenue: number;
  foundingProgramEnabled: boolean;
};

type LaunchesPayload = {
  network?: string;
  launches?: LaunchRecord[];
  foundingCreator?: FoundingCreator;
  launch?: LaunchRecord;
  error?: string;
};

type Status = {
  kind:
    | "idle"
    | "working"
    | "success"
    | "error";
  message: string;
};

const NETWORK_LABEL =
  kodiakNetworkLabel();

const percent = (
  value: number,
) =>
  `${(
    value / 100
  ).toFixed(2)}%`;

function lastLaunchStorageKey() {
  /*
   * Preserve the current Devnet browser key exactly so existing launches
   * remain available. Mainnet gets its own isolated browser record.
   */
  return KODIAK_IS_DEVNET
    ? "kodiak-last-devnet-launch"
    : "kodiak-last-mainnet-launch";
}

function assertPayloadNetwork(
  network?: string,
) {
  if (
    network &&
    network !==
      KODIAK_NETWORK
  ) {
    throw new Error(
      `Creator API returned ${network} data while Kodiak is configured for ${KODIAK_NETWORK}.`,
    );
  }
}

export default function CreatorPage() {
  const {
    connected,
    publicKey,
  } = useWallet();

  const [
    launches,
    setLaunches,
  ] = useState<
    LaunchRecord[]
  >([]);

  const [
    foundingCreator,
    setFoundingCreator,
  ] =
    useState<FoundingCreator | null>(
      null,
    );

  const [
    config,
    setConfig,
  ] =
    useState<FeeConfig | null>(
      null,
    );

  const [
    status,
    setStatus,
  ] = useState<Status>({
    kind: "idle",
    message:
      "Connect the creator wallet, then sync its latest Kodiak launch.",
  });

  const refresh =
    async () => {
      if (!publicKey) {
        setStatus({
          kind: "error",
          message:
            "Connect a creator wallet first.",
        });
        return;
      }

      try {
        setStatus({
          kind: "working",
          message:
            "Loading creator dashboard...",
        });

        const address =
          publicKey.toBase58();

        const [
          launchResponse,
          configResponse,
        ] =
          await Promise.all([
            fetch(
              `/api/creator/launches?creator=${encodeURIComponent(
                address,
              )}`,
              {
                cache:
                  "no-store",
              },
            ),
            fetch(
              "/api/config",
              {
                cache:
                  "no-store",
              },
            ),
          ]);

        const launchData =
          (await launchResponse.json()) as LaunchesPayload;

        const configData =
          (await configResponse.json()) as FeeConfig & {
            error?: string;
          };

        if (
          !launchResponse.ok
        ) {
          throw new Error(
            launchData.error ||
              "Unable to load creator launches.",
          );
        }

        if (
          !configResponse.ok
        ) {
          throw new Error(
            configData.error ||
              "Unable to load Kodiak configuration.",
          );
        }

        assertPayloadNetwork(
          launchData.network,
        );

        const nextLaunches =
          (
            launchData.launches ??
            []
          ).filter(
            (launch) =>
              !launch.network ||
              launch.network ===
                KODIAK_NETWORK,
          );

        setLaunches(
          nextLaunches,
        );

        setFoundingCreator(
          launchData.foundingCreator ??
            null,
        );

        setConfig(
          configData,
        );

        setStatus({
          kind: "success",
          message:
            `Creator dashboard refreshed on ${NETWORK_LABEL}.`,
        });
      } catch (error) {
        setStatus({
          kind: "error",
          message:
            error instanceof
            Error
              ? error.message
              : "Refresh failed.",
        });
      }
    };

  const syncLastLaunch =
    async () => {
      if (!publicKey) {
        setStatus({
          kind: "error",
          message:
            "Connect the wallet that created the token.",
        });
        return;
      }

      try {
        const raw =
          window.localStorage.getItem(
            lastLaunchStorageKey(),
          );

        if (!raw) {
          throw new Error(
            `No saved ${NETWORK_LABEL} launch was found in this browser. Use the browser that launched the token.`,
          );
        }

        const saved =
          JSON.parse(
            raw,
          ) as SavedLaunch;

        if (
          saved.network &&
          saved.network !==
            KODIAK_NETWORK
        ) {
          throw new Error(
            `The saved launch belongs to ${saved.network}, not ${KODIAK_NETWORK}.`,
          );
        }

        const signature =
          saved.signatures?.[0];

        if (
          !saved.mint ||
          !signature
        ) {
          throw new Error(
            "The saved launch is missing its mint or signature.",
          );
        }

        setStatus({
          kind: "working",
          message:
            `Verifying the launch on Solana ${NETWORK_LABEL}...`,
        });

        const response =
          await fetch(
            "/api/creator/launches",
            {
              method:
                "POST",
              headers: {
                "Content-Type":
                  "application/json",
              },
              body:
                JSON.stringify({
                  mint:
                    saved.mint,
                  creator:
                    publicKey.toBase58(),
                  name:
                    saved.name,
                  symbol:
                    saved.symbol,
                  signature,
                  createdAt:
                    saved.createdAt,
                }),
            },
          );

        const data =
          (await response.json()) as LaunchesPayload;

        if (
          !response.ok ||
          !data.launch
        ) {
          throw new Error(
            data.error ||
              "Launch registration failed.",
          );
        }

        assertPayloadNetwork(
          data.network,
        );

        if (
          data.launch.network &&
          data.launch.network !==
            KODIAK_NETWORK
        ) {
          throw new Error(
            `The verified launch belongs to ${data.launch.network}, not ${KODIAK_NETWORK}.`,
          );
        }

        setFoundingCreator(
          data.foundingCreator ??
            null,
        );

        await refresh();

        setStatus({
          kind: "success",
          message:
            `Launch verified on ${NETWORK_LABEL} and added to your creator dashboard.`,
        });
      } catch (error) {
        setStatus({
          kind: "error",
          message:
            error instanceof
            Error
              ? error.message
              : "Sync failed.",
        });
      }
    };

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-white sm:py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <nav className="flex flex-wrap items-center gap-2">
          <Link
            href="/"
            className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-black"
          >
            Home
          </Link>

          <Link
            href="/dashboard"
            className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-black"
          >
            Command Center
          </Link>

          <Link
            href="/creator"
            className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-black"
          >
            Creator Setup
          </Link>
        </nav>

        <header className="rounded-3xl border border-emerald-400/20 bg-white/[0.03] p-6">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.24em] text-emerald-300">
                Kodiak Creator
              </p>

              <h1 className="mt-2 text-4xl font-black">
                Creator Dashboard
              </h1>

              <p className="mt-3 max-w-2xl text-zinc-400">
                Verified{" "}
                {NETWORK_LABEL}{" "}
                launches and the
                current Kodiak fee
                model.
              </p>
            </div>

            <KodiakWalletButton />
          </div>

          {foundingCreator?.isFoundingCreator && (
            <div className="mt-5 inline-flex max-w-full items-center gap-3 rounded-2xl border border-amber-300/40 bg-amber-300/[0.08] px-4 py-3 text-sm font-black text-amber-300">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-amber-300/40 bg-amber-300/10 text-xs">
                FC
              </span>

              <span className="break-words">
                {foundingCreator.label ??
                  `FOUNDING CREATOR #${String(
                    foundingCreator.number ??
                      0,
                  ).padStart(
                    3,
                    "0",
                  )}`}
              </span>
            </div>
          )}

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() =>
                void syncLastLaunch()
              }
              disabled={
                !connected ||
                status.kind ===
                  "working"
              }
              className="rounded-2xl bg-gradient-to-r from-emerald-400 to-amber-300 px-5 py-4 font-black text-black disabled:opacity-40"
            >
              Sync Last Kodiak
              Launch
            </button>

            <button
              type="button"
              onClick={() =>
                void refresh()
              }
              disabled={
                !connected ||
                status.kind ===
                  "working"
              }
              className="rounded-2xl border border-white/10 px-5 py-4 font-black disabled:opacity-40"
            >
              Refresh Dashboard
            </button>
          </div>
        </header>

        <section
          className={`rounded-2xl border p-4 text-sm ${
            status.kind ===
            "error"
              ? "border-red-400/25 bg-red-400/[0.06] text-red-100"
              : status.kind ===
                  "success"
                ? "border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-100"
                : "border-white/10 bg-white/[0.03] text-zinc-400"
          }`}
        >
          <p className="font-bold">
            {status.message}
          </p>
        </section>

        {config && (
          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-2xl font-black">
              Current fee model
            </h2>

            <p className="mt-2 text-sm text-zinc-500">
              Database
              configuration
              only. On-chain
              enforcement will
              be audited
              separately before
              Mainnet.
            </p>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
                <p className="font-black text-emerald-300">
                  Regular launch
                </p>

                <div className="mt-4 space-y-2 text-sm">
                  <p className="flex justify-between">
                    <span>
                      Creator
                    </span>
                    <strong>
                      {percent(
                        config.regularCreatorFeeBps,
                      )}
                    </strong>
                  </p>

                  <p className="flex justify-between">
                    <span>
                      Kodiak +
                      Success Fund
                    </span>
                    <strong>
                      {percent(
                        config.regularKodiakFeeBps,
                      )}
                    </strong>
                  </p>

                  <p className="flex justify-between">
                    <span>
                      Infrastructure
                    </span>
                    <strong>
                      {percent(
                        config.infrastructureFeeBps,
                      )}
                    </strong>
                  </p>

                  <p className="flex justify-between border-t border-white/10 pt-2">
                    <span>
                      Total
                    </span>
                    <strong>
                      {percent(
                        config.tradingFeeBps,
                      )}
                    </strong>
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.04] p-5">
                <p className="font-black text-amber-300">
                  Founding
                  Creator
                </p>

                <div className="mt-4 space-y-2 text-sm">
                  <p className="flex justify-between">
                    <span>
                      Creator
                    </span>
                    <strong>
                      {percent(
                        config.foundingCreatorFeeBps,
                      )}
                    </strong>
                  </p>

                  <p className="flex justify-between">
                    <span>
                      Kodiak +
                      Success Fund
                    </span>
                    <strong>
                      {percent(
                        config.foundingKodiakFeeBps,
                      )}
                    </strong>
                  </p>

                  <p className="flex justify-between">
                    <span>
                      Infrastructure
                    </span>
                    <strong>
                      {percent(
                        config.infrastructureFeeBps,
                      )}
                    </strong>
                  </p>

                  <p className="flex justify-between border-t border-white/10 pt-2">
                    <span>
                      Total
                    </span>
                    <strong>
                      {percent(
                        config.tradingFeeBps,
                      )}
                    </strong>
                  </p>
                </div>
              </div>
            </div>

            <p className="mt-4 text-sm text-zinc-400">
              Success Fund:{" "}
              <strong className="text-white">
                {
                  config.creatorSuccessFundPercentOfKodiakRevenue
                }
                %
              </strong>{" "}
              of Kodiak revenue.
            </p>
          </section>
        )}

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-2xl font-black">
              Verified launches
            </h2>

            <p className="text-sm font-bold text-emerald-300">
              {launches.length}{" "}
              launch
              {launches.length ===
              1
                ? ""
                : "es"}
            </p>
          </div>

          {launches.length ===
          0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-white/10 p-8 text-center text-zinc-500">
              No verified{" "}
              {NETWORK_LABEL}{" "}
              launches loaded
              yet.
            </div>
          ) : (
            <div className="mt-5 grid gap-4">
              {launches.map(
                (launch) => {
                  const founding =
                    Boolean(
                      foundingCreator?.isFoundingCreator,
                    );

                  return (
                    <article
                      key={
                        launch.mint
                      }
                      className="rounded-2xl border border-white/10 bg-black/30 p-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p className="text-xl font-black">
                            {
                              launch.name
                            }{" "}
                            | $
                            {
                              launch.symbol
                            }
                          </p>

                          <p className="mt-2 break-all font-mono text-xs text-zinc-500">
                            {
                              launch.mint
                            }
                          </p>
                        </div>

                        <span
                          className={
                            founding
                              ? "rounded-full bg-amber-300/15 px-3 py-1 text-xs font-black text-amber-300"
                              : "rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-300"
                          }
                        >
                          {founding
                            ? foundingCreator?.label ??
                              `Founding Creator #${foundingCreator?.number}`
                            : "Regular creator"}
                        </span>
                      </div>

                      <div className="mt-5 flex flex-wrap gap-3">
                        <a
                          href={`/token/${launch.mint}`}
                          className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-amber-300"
                        >
                          View token +
                          chart
                        </a>

                        <a
                          href={kodiakExplorerTransactionUrl(
                            launch.signature,
                          )}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-zinc-300"
                        >
                          Launch
                          transaction
                        </a>

                        <a
                          href={`/trade?mint=${encodeURIComponent(
                            launch.mint,
                          )}`}
                          className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-emerald-300"
                        >
                          Trade on{" "}
                          {
                            NETWORK_LABEL
                          }
                        </a>
                      </div>
                    </article>
                  );
                },
              )}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-amber-300/20 bg-amber-300/[0.04] p-6">
          <h2 className="text-xl font-black text-amber-300">
            Metrics coming next
          </h2>

          <p className="mt-3 text-sm leading-6 text-zinc-400">
            Bonding progress,
            SOL raised,
            holders, volume,
            and claimable
            creator fees
            require dedicated
            on-chain indexing
            and claim-account
            integration.
            Kodiak will not
            display invented
            estimates.
          </p>
        </section>
      </div>
    </main>
  );
}
