"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { LaunchChart } from "@/components/charts/LaunchChart";
import { KodiakWalletButton } from "@/components/wallet/KodiakWalletButton";
import { ClaimSolRewards } from "@/components/rewards/ClaimSolRewards";
import {
  KODIAK_NETWORK,
  kodiakExplorerAddressUrl,
  kodiakExplorerTransactionUrl,
  kodiakNetworkLabel,
} from "@/lib/solana/network";

type LaunchRecord = {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  signature: string;
  network?: string;
  createdAt: string;
};

type TokenPayload = {
  launch?: LaunchRecord;
  network?: string;
  error?: string;
};

type GraduationState = {
  network: string;
  mint: string;
  state: "active" | "migrating" | "graduated" | "cancelled" | "unknown";
  rawStatus: number;
  migrateType: "cpmm" | "amm";
  launchpadPoolId: string;
  platformId: string;
  cpConfigId: string | null;
  cpmmPoolId: string | null;
  bonding: {
    quoteCollectedRaw: string;
    quoteTargetRaw: string;
    progressBps: number;
    progressPercent: number;
    thresholdReached: boolean;
  };
  trading: {
    launchpadActive: boolean;
    graduationReady: boolean;
    migrationPending: boolean;
    graduated: boolean;
    cancelled: boolean;
    cpmmReady: boolean;
  };
};

const NETWORK_LABEL =
  kodiakNetworkLabel();

const short = (
  value: string,
) =>
  value
    ? `${value.slice(
        0,
        6,
      )}...${value.slice(
        -6,
      )}`
    : "-";

const formatDate = (
  value: string,
) => {
  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "Unknown";
  }

  return date.toLocaleString();
};

export default function TokenPage() {
  const { mint } =
    useParams<{
      mint: string;
    }>();

  const [
    launch,
    setLaunch,
  ] =
    useState<LaunchRecord | null>(
      null,
    );

  const [
    error,
    setError,
  ] = useState("");

  const [
    copied,
    setCopied,
  ] = useState(false);

  const [
    graduation,
    setGraduation,
  ] =
    useState<GraduationState | null>(
      null,
    );

  useEffect(() => {
    let cancelled =
      false;

    const load =
      async () => {
        try {
          const response =
            await fetch(
              `/api/token/${encodeURIComponent(
                mint,
              )}`,
              {
                cache:
                  "no-store",
              },
            );

          const payload =
            (await response.json()) as TokenPayload;

          if (
            !response.ok ||
            !payload.launch
          ) {
            throw new Error(
              payload.error ||
                "Unable to load token.",
            );
          }

          if (
            payload.network &&
            payload.network !==
              KODIAK_NETWORK
          ) {
            throw new Error(
              `Token API returned ${payload.network} data while Kodiak is configured for ${KODIAK_NETWORK}.`,
            );
          }

          if (
            payload.launch
              .network &&
            payload.launch
              .network !==
              KODIAK_NETWORK
          ) {
            throw new Error(
              `This launch belongs to ${payload.launch.network}, not ${KODIAK_NETWORK}.`,
            );
          }

          if (!cancelled) {
            setLaunch(
              payload.launch,
            );

            setError("");
          }
        } catch (caught) {
          if (!cancelled) {
            setError(
              caught instanceof
              Error
                ? caught.message
                : "Unable to load token.",
            );
          }
        }
      };

    void load();

    return () => {
      cancelled = true;
    };
  }, [mint]);

  useEffect(() => {
    if (!mint) {
      return;
    }

    let cancelled =
      false;

    const loadGraduation =
      async () => {
        try {
          const response =
            await fetch(
              `/api/token/${encodeURIComponent(
                mint,
              )}/graduation`,
              {
                cache:
                  "no-store",
              },
            );

          if (!response.ok) {
            return;
          }

          const payload =
            (await response.json()) as GraduationState;

          if (
            !cancelled &&
            payload.network ===
              KODIAK_NETWORK
          ) {
            setGraduation(
              payload,
            );
          }
        } catch {
          // Graduation polling is best-effort so the token page remains usable.
        }
      };

    void loadGraduation();

    const timer =
      window.setInterval(
        () => {
          void loadGraduation();
        },
        15_000,
      );

    return () => {
      cancelled = true;

      window.clearInterval(
        timer,
      );
    };
  }, [mint]);

  const copyMint =
    async () => {
      if (!launch?.mint) {
        return;
      }

      try {
        await navigator.clipboard.writeText(
          launch.mint,
        );

        setCopied(true);

        window.setTimeout(
          () =>
            setCopied(
              false,
            ),
          1500,
        );
      } catch {
        setCopied(false);
      }
    };

  if (error) {
    return (
      <main className="min-h-screen bg-black px-4 py-8 text-white sm:px-6">
        <div className="mx-auto max-w-4xl">
          <section className="rounded-3xl border border-red-400/20 bg-red-400/[0.06] p-6">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-red-300">
              Token unavailable
            </p>

            <h1 className="mt-2 text-2xl font-black">
              {error}
            </h1>

            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/"
                className="rounded-xl border border-white/10 px-4 py-3 text-sm font-black"
              >
                Home
              </Link>

              <Link
                href="/explore"
                className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-black"
              >
                Back to Explore
              </Link>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (!launch) {
    return (
      <main className="min-h-screen bg-black px-4 py-8 text-zinc-400 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="animate-pulse rounded-3xl border border-white/10 bg-white/[0.03] p-8">
            Loading Kodiak
            token...
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#070707] px-4 py-6 text-white sm:px-6 sm:py-8">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <header className="rounded-[2rem] border border-emerald-400/20 bg-gradient-to-br from-emerald-400/[0.08] via-white/[0.025] to-amber-300/[0.06] p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-300">
                {graduation?.trading.graduated
                  ? "Kodiak ÃÂÃÂ· Raydium CPMM"
                  : "Kodiak LaunchLab"}
                {" | "}
                {NETWORK_LABEL}
              </p>

              <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-2">
                <h1 className="break-words text-4xl font-black sm:text-5xl">
                  {launch.name}
                </h1>

                <p className="text-2xl font-black text-amber-300">
                  $
                  {
                    launch.symbol
                  }
                </p>
              </div>

              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
                Live Kodiak
                market data, real{" "}
                {NETWORK_LABEL}{" "}
                trades, creator
                identity, and
                launch
                verification in
                one trading
                workspace.
              </p>
            </div>

            <KodiakWalletButton />
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <InfoCard
              label="Mint"
              value={short(
                launch.mint,
              )}
              mono
            />

            <InfoCard
              label="Creator"
              value={short(
                launch.creator,
              )}
              mono
            />

            <InfoCard
              label="Launched"
              value={formatDate(
                launch.createdAt,
              )}
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() =>
                void copyMint()
              }
              className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-black transition hover:bg-white/[0.07]"
            >
              {copied
                ? "Mint copied"
                : "Copy mint"}
            </button>

            <a
              href={kodiakExplorerAddressUrl(
                launch.mint,
              )}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-black text-amber-300 transition hover:bg-white/[0.07]"
            >
              Solana Explorer
            </a>

            <Link
              href={`/trade?mint=${encodeURIComponent(
                launch.mint,
              )}`}
              className="rounded-xl bg-emerald-400 px-5 py-3 text-sm font-black text-black transition hover:bg-emerald-300"
            >
              Trade on{" "}
              {NETWORK_LABEL}
            </Link>
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <LaunchChart
              mint={
                launch.mint
              }
            />
          </div>

          <aside className="space-y-5">
            <ClaimSolRewards mint={launch.mint} />
            <section className="rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.04] p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
                Trade
              </p>

              <h2 className="mt-2 text-2xl font-black">
                Buy or sell $
                {
                  launch.symbol
                }
              </h2>

              <p className="mt-3 text-sm leading-6 text-zinc-400">
                Open the Kodiak{" "}
                {NETWORK_LABEL}{" "}
                trading panel
                with this token
                already selected.
              </p>

              <Link
                href={`/trade?mint=${encodeURIComponent(
                  launch.mint,
                )}`}
                className="mt-5 block rounded-2xl bg-emerald-400 px-5 py-4 text-center font-black text-black"
              >
                Open trading
                panel
              </Link>
            </section>

            <section className="rounded-3xl border border-amber-300/20 bg-amber-300/[0.04] p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">
                Creator
              </p>

              <h2 className="mt-2 text-2xl font-black">
                {short(
                  launch.creator,
                )}
              </h2>

              <p className="mt-3 break-all font-mono text-xs leading-5 text-zinc-500">
                {
                  launch.creator
                }
              </p>

              <div className="mt-5 grid gap-3">
                <Link
                  href={`/creator/${launch.creator}`}
                  className="rounded-xl bg-amber-300 px-4 py-3 text-center text-sm font-black text-black"
                >
                  View public creator profile
                </Link>

                <Link
                  href="/creator"
                  className="rounded-xl border border-white/10 px-4 py-3 text-center text-sm font-black text-zinc-300"
                >
                  Creator setup
                </Link>
              </div>
            </section>

            <section
              className={`rounded-3xl border p-5 ${
                graduation?.trading.graduated
                  ? "border-amber-300/25 bg-amber-300/[0.05]"
                  : graduation?.trading.graduationReady
                    ? "border-amber-300/25 bg-amber-300/[0.05]"
                    : graduation?.trading.cancelled
                      ? "border-red-400/25 bg-red-400/[0.05]"
                      : "border-white/10 bg-white/[0.025]"
              }`}
            >
              <p className="text-xs font-black uppercase tracking-[0.18em] text-zinc-500">
                Launch lifecycle
              </p>

              <h2 className="mt-2 text-xl font-black">
                {graduation?.trading.graduated
                  ? "Graduated to Raydium CPMM"
                  : graduation?.trading.migrationPending
                    ? "Migrating to Raydium CPMM"
                    : graduation?.trading.graduationReady
                      ? "Graduation ready"
                      : graduation?.trading.cancelled
                        ? "Launch cancelled"
                        : "LaunchLab bonding curve"}
              </h2>

              {graduation ? (
                <>
                  <div className="mt-5 flex items-center justify-between gap-4 text-sm">
                    <span className="text-zinc-500">
                      Bonding progress
                    </span>

                    <span className="font-black">
                      {Math.min(
                        100,
                        graduation.bonding.progressPercent,
                      ).toFixed(2)}
                      %
                    </span>
                  </div>

                  <div className="mt-2 h-3 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-amber-300"
                      style={{
                        width: `${Math.min(
                          100,
                          graduation.bonding.progressPercent,
                        )}%`,
                      }}
                    />
                  </div>

                  <div className="mt-5 space-y-3 text-sm">
                    <DetailRow
                      label="State"
                      value={
                        graduation.trading.graduated
                          ? "Graduated"
                          : graduation.trading.migrationPending
                            ? "Migrating"
                            : graduation.trading.graduationReady
                              ? "Graduation ready"
                              : graduation.trading.cancelled
                                ? "Cancelled"
                                : "Bonding"
                      }
                    />

                    <DetailRow
                      label="Migration"
                      value={
                        graduation.migrateType ===
                        "cpmm"
                          ? "Raydium CPMM"
                          : "Raydium AMM"
                      }
                    />
                  </div>

                  {graduation.cpmmPoolId && (
                    <a
                      href={kodiakExplorerAddressUrl(
                        graduation.cpmmPoolId,
                      )}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-5 block rounded-xl border border-amber-300/20 px-4 py-3 text-center text-sm font-black text-amber-300"
                    >
                      View graduated CPMM pool
                    </a>
                  )}

                  {graduation.trading.graduationReady &&
                    !graduation.trading.migrationPending && (
                      <p className="mt-4 text-sm leading-6 text-amber-200">
                        The bonding target has been reached. Kodiak is waiting for LaunchLab to begin the on-chain migration transition.
                      </p>
                    )}

                  {graduation.trading.migrationPending && (
                    <p className="mt-4 text-sm leading-6 text-amber-200">
                      LaunchLab funding is complete and the token is migrating to Raydium CPMM. Curve trading remains paused until LaunchLab reaches its Trade state.
                    </p>
                  )}

                  {graduation.trading.graduated &&
                    !graduation.trading.cpmmReady && (
                      <p className="mt-4 text-sm leading-6 text-amber-200">
                        Graduation is confirmed. Kodiak is waiting for the CPMM pool account to become available.
                      </p>
                    )}
                </>
              ) : (
                <p className="mt-4 text-sm leading-6 text-zinc-500">
                  Reading verified LaunchLab state from Solana...
                </p>
              )}
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.025] p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-zinc-500">
                Launch
                verification
              </p>

              <div className="mt-4 space-y-3 text-sm">
                <DetailRow
                  label="Network"
                  value={`Solana ${NETWORK_LABEL}`}
                />

                <DetailRow
                  label="Status"
                  value={
                    graduation?.trading.graduated
                      ? "Verified Â· Graduated"
                      : graduation?.trading.migrationPending
                        ? "Verified Â· Migrating"
                        : graduation?.trading.graduationReady
                          ? "Verified Â· Graduation ready"
                          : graduation?.trading.cancelled
                            ? "Verified Â· Cancelled"
                            : "Verified launch"
                  }
                />

                <DetailRow
                  label="Symbol"
                  value={`$${launch.symbol}`}
                />
              </div>

              <a
                href={kodiakExplorerTransactionUrl(
                  launch.signature,
                )}
                target="_blank"
                rel="noreferrer"
                className="mt-5 block rounded-xl border border-white/10 px-4 py-3 text-center text-sm font-black text-zinc-300"
              >
                View launch
                transaction
              </a>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

function InfoCard({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-600">
        {label}
      </p>

      <p
        className={`mt-2 break-words text-sm font-black ${
          mono
            ? "font-mono"
            : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.07] bg-black/25 px-4 py-3">
      <span className="text-zinc-500">
        {label}
      </span>

      <span className="text-right font-black text-zinc-200">
        {value}
      </span>
    </div>
  );
}
