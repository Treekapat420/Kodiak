"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";

import { ClaimCreatorRewards } from "@/components/creator/ClaimCreatorRewards";
import {
  KODIAK_IS_DEVNET,
  KODIAK_NETWORK,
  kodiakNetworkLabel,
} from "@/lib/solana/network";

type Launch = {
  mint: string;
  name: string;
  symbol: string;
  trades: number;
  buys: number;
  sells: number;
  volumeSol: number;
};

type Ledger = {
  id: string;
  mint: string;
  side: "buy" | "sell";
  solAmount: number;
  creatorRewardSol: number;
  successFundSol: number;
  timestamp: number;
  network?: string;
};

type FoundingCreator = {
  isFoundingCreator: boolean;
  number: number | null;
  label: string | null;
};

type Payload = {
  network?: string;
  launches?: Launch[];
  ledger?: Ledger[];
  foundingCreator?: FoundingCreator;
  totals?: {
    creatorRewardsSol: number;
    kodiakFeesSol: number;
    infraFeesSol: number;
    successFundSol: number;
    trackedVolumeSol: number;
    launchCount: number;
    tradeCount: number;
  };
  error?: string;
};

const NETWORK_LABEL = kodiakNetworkLabel();

const fmt = (
  n: number,
  digits = 6,
) =>
  Number(n || 0).toLocaleString(
    "en-US",
    {
      maximumFractionDigits:
        digits,
    },
  );

const short = (
  s: string,
) =>
  s
    ? `${s.slice(0, 4)}...${s.slice(-4)}`
    : "-";

const ago = (
  ts: number,
) => {
  const seconds = Math.max(
    0,
    Math.floor(
      Date.now() / 1000 -
        ts,
    ),
  );

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }

  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }

  return `${Math.floor(seconds / 86400)}d ago`;
};

export default function DashboardPage() {
  const { publicKey } =
    useWallet();

  const wallet =
    publicKey?.toBase58() ??
    "";

  const [
    data,
    setData,
  ] = useState<Payload>({});

  const [
    status,
    setStatus,
  ] = useState(
    "Connect your wallet to load creator data.",
  );

  useEffect(() => {
    if (!wallet) {
      setData({});

      setStatus(
        "Connect your wallet to load creator data.",
      );

      return;
    }

    let cancelled = false;

    const load =
      async () => {
        try {
          const response =
            await fetch(
              `/api/creator/dashboard?wallet=${encodeURIComponent(
                wallet,
              )}`,
              {
                cache:
                  "no-store",
              },
            );

          const payload =
            (await response.json()) as Payload;

          if (
            !response.ok
          ) {
            throw new Error(
              payload.error ||
                "Unable to load dashboard.",
            );
          }

          if (
            payload.network &&
            payload.network !==
              KODIAK_NETWORK
          ) {
            throw new Error(
              `Creator Dashboard returned ${payload.network} data while Kodiak is configured for ${KODIAK_NETWORK}.`,
            );
          }

          if (!cancelled) {
            setData(
              payload,
            );

            setStatus(
              `Live ${NETWORK_LABEL} creator accounting | refreshes every 10 seconds`,
            );
          }
        } catch (error) {
          if (!cancelled) {
            setStatus(
              error instanceof
              Error
                ? error.message
                : "Unable to load dashboard.",
            );
          }
        }
      };

    void load();

    const timer =
      window.setInterval(
        () =>
          void load(),
        10_000,
      );

    return () => {
      cancelled = true;

      window.clearInterval(
        timer,
      );
    };
  }, [wallet]);

  const totals =
    data.totals ?? {
      creatorRewardsSol:
        0,
      kodiakFeesSol:
        0,
      infraFeesSol:
        0,
      successFundSol:
        0,
      trackedVolumeSol:
        0,
      launchCount:
        0,
      tradeCount:
        0,
    };

  const launches =
    data.launches ?? [];

  const ledger =
    data.ledger ?? [];

  const foundingCreator =
    data.foundingCreator;

  return (
    <main className="min-h-screen bg-[#070707] px-4 py-6 text-zinc-100 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-7xl">
        <nav className="mb-5 flex flex-wrap items-center gap-2">
          <Link
            href="/"
            className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-black"
          >
            Home
          </Link>

          <Link
            href="/dashboard"
            className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-black"
          >
            Command Center
          </Link>

          <Link
            href="/creator"
            className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-black"
          >
            Creator Setup
          </Link>

          {wallet ? (
            <Link
              href={`/creator/${wallet}`}
              className="rounded-xl border border-amber-300/30 bg-amber-300/[0.08] px-4 py-3 text-sm font-black text-amber-300"
            >
              My Public Profile
            </Link>
          ) : null}
        </nav>

        <header className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-emerald-400/10 via-white/[0.03] to-amber-300/10 p-6 sm:p-9">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-emerald-300">
            Creator Dashboard
            V2
          </p>

          <div className="mt-3 flex flex-wrap items-start justify-between gap-5">
            <div>
              <h1 className="text-4xl font-black sm:text-5xl">
                Creator Command
                Center
              </h1>

              <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">
                Real launch
                analytics plus
                an auditable{" "}
                {NETWORK_LABEL}{" "}
                accounting
                ledger for
                creator rewards
                and Kodiak&apos;s
                Creator Success
                Fund.
              </p>

              <p className="mt-2 text-xs font-bold text-zinc-500">
                {status}
              </p>
            </div>

            <div className="flex gap-3">
              <Link
                href="/explore"
                className="rounded-xl border border-white/10 px-4 py-3 text-sm font-black"
              >
                Explore
              </Link>

              <Link
                href="/launch"
                className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-black"
              >
                Launch token
              </Link>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-zinc-600">
              Connected creator
            </p>

            <p className="mt-2 break-all font-black">
              {wallet ||
                "Wallet not connected"}
            </p>

            {wallet ? (
              <Link
                href={`/creator/${wallet}`}
                className="mt-4 inline-flex rounded-xl bg-amber-300 px-4 py-3 text-sm font-black text-black"
              >
                View my public profile
              </Link>
            ) : (
              <p className="mt-3 text-xs text-zinc-500">
                Connect your creator wallet to open your public profile.
              </p>
            )}
          </div>

          {foundingCreator
            ?.isFoundingCreator && (
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
        </header>

        <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Launches"
            value={String(
              totals.launchCount,
            )}
          />

          <Metric
            label="Recorded trades"
            value={String(
              totals.tradeCount,
            )}
          />

          <Metric
            label="Tracked volume"
            value={`${fmt(
              totals.trackedVolumeSol,
            )} SOL`}
          />

          <Metric
            label="Creator tracked"
            value={`${fmt(
              totals.creatorRewardsSol,
              8,
            )} SOL`}
            accent
          />
        </section>

        <ClaimCreatorRewards />

        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card
            title="Fee ledger totals"
            eyebrow="Revenue accounting"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Box
                label="Creator tracked"
                value={`${fmt(
                  totals.creatorRewardsSol,
                  8,
                )} SOL`}
                note="0.45% of tracked trades"
              />

              <Box
                label="Kodiak accrued"
                value={`${fmt(
                  totals.kodiakFeesSol,
                  8,
                )} SOL`}
                note="0.50% platform accounting"
              />

              <Box
                label="Infrastructure"
                value={`${fmt(
                  totals.infraFeesSol,
                  8,
                )} SOL`}
                note="0.25% accounting"
              />

              <Box
                label="Success Fund"
                value={`${fmt(
                  totals.successFundSol,
                  8,
                )} SOL`}
                note="5% of Kodiak revenue"
              />
            </div>

            <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/[0.05] p-4">
              <p className="font-black text-amber-200">
                Kodiak audit
                ledger -
                separate from
                Raydium&apos;s
                on-chain vault.
              </p>

              <p className="mt-2 text-xs leading-6 text-zinc-500">
                {KODIAK_IS_DEVNET
                  ? "The ledger records what accrues under Kodiak's current Devnet fee model. Raydium's on-chain vault remains the authority for actual creator claims, while Kodiak's Creator Success Fund treasury transfer remains disabled during Devnet testing."
                  : "The ledger records Kodiak's tracked fee accounting for the active Mainnet environment. Raydium's on-chain vault remains the authority for actual claimable creator fees."}
              </p>
            </div>
          </Card>

          <Card
            title="Current fee model"
            eyebrow="Transparent economics"
          >
            <div className="space-y-3">
              <Row
                label="Creator"
                value="0.45%"
              />

              <Row
                label="Kodiak"
                value="0.50%"
              />

              <Row
                label="Infrastructure"
                value="0.25%"
              />

              <Row
                label="Creator Success Fund"
                value="5% of Kodiak revenue"
              />
            </div>
          </Card>
        </section>

        <section className="mt-6 rounded-[2rem] border border-white/10 bg-white/[0.025] p-5 sm:p-6">
          <h2 className="text-2xl font-black">
            Your launches
          </h2>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {launches.length ? (
              launches.map(
                (launch) => (
                  <Link
                    key={
                      launch.mint
                    }
                    href={`/token/${launch.mint}`}
                    className="rounded-2xl border border-white/10 bg-black/25 p-4"
                  >
                    <div className="flex justify-between gap-3">
                      <div>
                        <p className="font-black">
                          {
                            launch.name
                          }
                        </p>

                        <p className="mt-1 text-xs font-black text-amber-300">
                          $
                          {
                            launch.symbol
                          }
                        </p>
                      </div>

                      <span className="text-xs text-zinc-600">
                        {short(
                          launch.mint,
                        )}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <Mini
                        label="Volume"
                        value={`${fmt(
                          launch.volumeSol,
                        )} SOL`}
                      />

                      <Mini
                        label="Trades"
                        value={String(
                          launch.trades,
                        )}
                      />

                      <Mini
                        label="Buys"
                        value={String(
                          launch.buys,
                        )}
                      />

                      <Mini
                        label="Sells"
                        value={String(
                          launch.sells,
                        )}
                      />
                    </div>
                  </Link>
                ),
              )
            ) : (
              <div className="md:col-span-2 xl:col-span-3 rounded-2xl border border-dashed border-white/10 p-10 text-center text-zinc-500">
                No launches found
                for this connected
                wallet on{" "}
                {NETWORK_LABEL}.
              </div>
            )}
          </div>
        </section>

        <section className="mt-6 rounded-[2rem] border border-white/10 bg-white/[0.025] p-5 sm:p-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">
                Audit trail
              </p>

              <h2 className="mt-2 text-2xl font-black">
                Creator reward
                ledger
              </h2>
            </div>

            <span className="text-xs text-zinc-600">
              {ledger.length}{" "}
              entries
            </span>
          </div>

          <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
            {ledger.length ? (
              ledger
                .filter(
                  (entry) =>
                    !entry.network ||
                    entry.network ===
                      KODIAK_NETWORK,
                )
                .slice(
                  0,
                  100,
                )
                .map(
                  (entry) => (
                    <div
                      key={
                        entry.id
                      }
                      className="grid gap-3 border-b border-white/[0.06] bg-black/20 p-4 sm:grid-cols-[1fr_auto_auto]"
                    >
                      <div>
                        <p className="text-sm font-black">
                          {entry.side.toUpperCase()}{" "}
                          |{" "}
                          {short(
                            entry.mint,
                          )}
                        </p>

                        <p className="mt-1 text-xs text-zinc-600">
                          {fmt(
                            entry.solAmount,
                          )}{" "}
                          SOL trade |{" "}
                          {ago(
                            entry.timestamp,
                          )}
                        </p>
                      </div>

                      <div className="sm:text-right">
                        <p className="text-xs text-zinc-600">
                          Creator
                        </p>

                        <p className="mt-1 text-sm font-black text-emerald-300">
                          +
                          {fmt(
                            entry.creatorRewardSol,
                            8,
                          )}{" "}
                          SOL
                        </p>
                      </div>

                      <div className="sm:text-right">
                        <p className="text-xs text-zinc-600">
                          Success Fund
                        </p>

                        <p className="mt-1 text-sm font-black text-amber-300">
                          +
                          {fmt(
                            entry.successFundSol,
                            8,
                          )}{" "}
                          SOL
                        </p>
                      </div>
                    </div>
                  ),
                )
            ) : (
              <div className="p-10 text-center text-zinc-500">
                Recorded trades
                on your launches
                will create ledger
                entries
                automatically.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
      <p className="text-[11px] font-black uppercase tracking-[0.15em] text-zinc-600">
        {label}
      </p>

      <p
        className={`mt-2 text-2xl font-black ${
          accent
            ? "text-emerald-300"
            : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Card({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[2rem] border border-white/10 bg-white/[0.025] p-5">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">
        {eyebrow}
      </p>

      <h2 className="mt-2 text-2xl font-black">
        {title}
      </h2>

      <div className="mt-5">
        {children}
      </div>
    </div>
  );
}

function Box({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
      <p className="text-xs text-zinc-500">
        {label}
      </p>

      <p className="mt-2 text-xl font-black">
        {value}
      </p>

      <p className="mt-1 text-xs text-zinc-600">
        {note}
      </p>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex justify-between gap-4 rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
      <span className="text-sm text-zinc-500">
        {label}
      </span>

      <span className="text-sm font-black">
        {value}
      </span>
    </div>
  );
}

function Mini({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
      <p className="text-[10px] uppercase tracking-[0.1em] text-zinc-600">
        {label}
      </p>

      <p className="mt-1 text-sm font-black">
        {value}
      </p>
    </div>
  );
}
