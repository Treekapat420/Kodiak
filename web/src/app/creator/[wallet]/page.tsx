"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { KodiakWalletButton } from "@/components/wallet/KodiakWalletButton";
import { PublicProfileEditor } from "@/components/creator/PublicProfileEditor";
import {
  KODIAK_NETWORK,
  kodiakExplorerAddressUrl,
  kodiakNetworkLabel,
} from "@/lib/solana/network";

type FoundingCreator = {
  isFoundingCreator: boolean;
  number: number | null;
  label: string | null;
};

type PublicLaunch = {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  network?: string;
  createdAt?: string;
  tradeCount: number;
  buys: number;
  sells: number;
  volumeSol: number;
  latestTradeAt: number;
};

type PublicProfile = {
  wallet: string;
  displayName: string;
  username: string;
  bio: string;
  avatarUrl: string;
  xUrl: string;
  telegramUrl: string;
  websiteUrl: string;
  foundingCreator: FoundingCreator;
  launches: PublicLaunch[];
  totals: {
    launchCount: number;
    tradeCount: number;
    buys: number;
    sells: number;
    volumeSol: number;
  };
};

type ProfilePayload = {
  network?: string;
  profile?: PublicProfile;
  error?: string;
};

const NETWORK_LABEL =
  kodiakNetworkLabel();

function shortAddress(
  value: string,
) {
  return value
    ? `${value.slice(
        0,
        6,
      )}...${value.slice(
        -6,
      )}`
    : "-";
}

function formatSol(
  value: number,
) {
  if (
    !Number.isFinite(
      value,
    ) ||
    value <= 0
  ) {
    return "0";
  }

  if (value >= 100) {
    return value.toFixed(
      1,
    );
  }

  if (value >= 1) {
    return value.toFixed(
      3,
    );
  }

  return value.toFixed(
    6,
  );
}

function formatDate(
  value?: string,
) {
  if (!value) {
    return "Unknown";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "Unknown";
  }

  return date.toLocaleDateString();
}

export default function PublicCreatorProfilePage() {
  const { wallet } =
    useParams<{
      wallet: string;
    }>();

  const [
    profile,
    setProfile,
  ] =
    useState<PublicProfile | null>(
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

  useEffect(() => {
    let cancelled =
      false;

    const load =
      async () => {
        try {
          const response =
            await fetch(
              `/api/creator/${encodeURIComponent(
                wallet,
              )}/profile`,
              {
                cache:
                  "no-store",
              },
            );

          const payload =
            (await response.json()) as ProfilePayload;

          if (
            !response.ok ||
            !payload.profile
          ) {
            throw new Error(
              payload.error ||
                "Unable to load creator profile.",
            );
          }

          if (
            payload.network &&
            payload.network !==
              KODIAK_NETWORK
          ) {
            throw new Error(
              `Creator profile returned ${payload.network} data while Kodiak is configured for ${KODIAK_NETWORK}.`,
            );
          }

          if (!cancelled) {
            setProfile(
              payload.profile,
            );

            setError("");
          }
        } catch (caught) {
          if (!cancelled) {
            setError(
              caught instanceof
              Error
                ? caught.message
                : "Unable to load creator profile.",
            );
          }
        }
      };

    void load();

    return () => {
      cancelled = true;
    };
  }, [
    wallet,
  ]);

  const copyWallet =
    async () => {
      if (!profile?.wallet) {
        return;
      }

      try {
        await navigator.clipboard.writeText(
          profile.wallet,
        );

        setCopied(
          true,
        );

        window.setTimeout(
          () =>
            setCopied(
              false,
            ),
          1500,
        );
      } catch {
        setCopied(
          false,
        );
      }
    };

  if (error) {
    return (
      <main className="min-h-screen bg-[#070707] px-4 py-8 text-white sm:px-6">
        <div className="mx-auto max-w-5xl">
          <section className="rounded-3xl border border-red-400/20 bg-red-400/[0.06] p-6">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-red-300">
              Creator unavailable
            </p>

            <h1 className="mt-2 text-2xl font-black">
              {error}
            </h1>

            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/explore"
                className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-black"
              >
                Explore Kodiak
              </Link>

              <Link
                href="/"
                className="rounded-xl border border-white/10 px-4 py-3 text-sm font-black"
              >
                Home
              </Link>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="min-h-screen bg-[#070707] px-4 py-8 text-zinc-400 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="animate-pulse rounded-3xl border border-white/10 bg-white/[0.03] p-8">
            Loading creator
            profile...
          </div>
        </div>
      </main>
    );
  }

  const founding =
    profile.foundingCreator;

  return (
    <main className="min-h-screen bg-[#070707] px-4 py-6 text-white sm:px-6 sm:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <nav className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Link
              href="/"
              className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-black"
            >
              Home
            </Link>

            <Link
              href="/explore"
              className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-black"
            >
              Explore
            </Link>
          </div>

          <KodiakWalletButton />
        </nav>

        <header className="overflow-hidden rounded-[2rem] border border-emerald-400/20 bg-gradient-to-br from-emerald-400/[0.10] via-white/[0.025] to-amber-300/[0.08]">
          <div className="h-2 bg-gradient-to-r from-emerald-400 via-amber-300 to-emerald-400" />

          <div className="p-6 sm:p-9">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.24em] text-emerald-300">
                  Kodiak Creator
                  {" | "}
                  {NETWORK_LABEL}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-4">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-3xl border border-amber-300/30 bg-amber-300/10 text-2xl font-black text-amber-300">
                    {profile.avatarUrl ? <img src={profile.avatarUrl} alt="Creator profile" className="h-full w-full object-cover" /> : profile.wallet.slice(0, 2)}
                  </div>

                  <div className="min-w-0">
                    <h1 className="text-3xl font-black sm:text-5xl">{profile.displayName || shortAddress(profile.wallet)}</h1>
                    {profile.username && <p className="mt-1 font-bold text-emerald-300">@{profile.username}</p>}

                    <p className="mt-2 break-all font-mono text-xs leading-5 text-zinc-500">
                      {
                        profile.wallet
                      }
                    </p>
                  </div>
                </div>

                {profile.bio && <p className="mt-5 max-w-2xl text-sm leading-6 text-zinc-300">{profile.bio}</p>}
                <div className="mt-4 flex flex-wrap gap-3 text-sm font-black text-amber-300">
                  {profile.websiteUrl && <a href={profile.websiteUrl} target="_blank" rel="noreferrer">Website</a>}
                  {profile.xUrl && <a href={profile.xUrl} target="_blank" rel="noreferrer">X</a>}
                  {profile.telegramUrl && <a href={profile.telegramUrl} target="_blank" rel="noreferrer">Telegram</a>}
                </div>
                <PublicProfileEditor wallet={profile.wallet} initial={{ displayName:profile.displayName, username:profile.username, bio:profile.bio, avatarUrl:profile.avatarUrl, xUrl:profile.xUrl, telegramUrl:profile.telegramUrl, websiteUrl:profile.websiteUrl }} onSaved={(meta)=>setProfile(current=>current?{...current,...meta}:current)} />

                {founding.isFoundingCreator && (
                  <div className="mt-5 inline-flex items-center gap-3 rounded-2xl border border-amber-300/40 bg-amber-300/[0.08] px-4 py-3 text-sm font-black text-amber-300">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full border border-amber-300/40 bg-amber-300/10 text-xs">
                      FC
                    </span>

                    <span>
                      {founding.label ??
                        `FOUNDING CREATOR #${String(
                          founding.number ??
                            0,
                        ).padStart(
                          3,
                          "0",
                        )}`}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() =>
                    void copyWallet()
                  }
                  className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm font-black"
                >
                  {copied
                    ? "Wallet copied"
                    : "Copy wallet"}
                </button>

                <a
                  href={kodiakExplorerAddressUrl(
                    profile.wallet,
                  )}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm font-black text-amber-300"
                >
                  Solana Explorer
                </a>
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric
            label="Launches"
            value={String(
              profile.totals
                .launchCount,
            )}
          />

          <Metric
            label="Trades"
            value={String(
              profile.totals
                .tradeCount,
            )}
          />

          <Metric
            label="Volume"
            value={`${formatSol(
              profile.totals
                .volumeSol,
            )} SOL`}
            accent
          />

          <Metric
            label="Buys"
            value={String(
              profile.totals
                .buys,
            )}
          />

          <Metric
            label="Sells"
            value={String(
              profile.totals
                .sells,
            )}
          />
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-white/[0.025] p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">
                Public launches
              </p>

              <h2 className="mt-2 text-2xl font-black sm:text-3xl">
                Tokens launched
                by this creator
              </h2>
            </div>

            <span className="text-sm font-black text-emerald-300">
              {
                profile.launches
                  .length
              }{" "}
              verified
            </span>
          </div>

          {profile.launches.length ===
          0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-white/10 p-10 text-center">
              <p className="font-black text-zinc-300">
                No verified
                launches yet
              </p>

              <p className="mt-2 text-sm text-zinc-600">
                Verified Kodiak
                launches from this
                wallet will appear
                here.
              </p>
            </div>
          ) : (
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {profile.launches.map(
                (
                  launch,
                ) => (
                  <article
                    key={
                      launch.mint
                    }
                    className="rounded-2xl border border-white/10 bg-black/25 p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="truncate text-xl font-black">
                          {
                            launch.name
                          }
                        </h3>

                        <p className="mt-1 font-black text-amber-300">
                          $
                          {
                            launch.symbol
                          }
                        </p>
                      </div>

                      <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-[10px] font-black uppercase text-emerald-300">
                        Verified
                      </span>
                    </div>

                    <p className="mt-3 text-xs text-zinc-600">
                      Launched{" "}
                      {formatDate(
                        launch.createdAt,
                      )}
                    </p>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <Mini
                        label="Volume"
                        value={`${formatSol(
                          launch.volumeSol,
                        )} SOL`}
                      />

                      <Mini
                        label="Trades"
                        value={String(
                          launch.tradeCount,
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

                    <div className="mt-5 grid grid-cols-2 gap-3">
                      <Link
                        href={`/token/${launch.mint}`}
                        className="rounded-xl bg-emerald-400 px-4 py-3 text-center text-sm font-black text-black"
                      >
                        View token
                      </Link>

                      <Link
                        href={`/trade?mint=${encodeURIComponent(
                          launch.mint,
                        )}`}
                        className="rounded-xl border border-white/10 px-4 py-3 text-center text-sm font-black text-zinc-200"
                      >
                        Trade
                      </Link>
                    </div>
                  </article>
                ),
              )}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.025] p-5 text-sm leading-6 text-zinc-500">
          This public profile shows
          verified Kodiak launch and
          market activity only.
          Private creator-reward and
          revenue accounting remains
          in the connected creator
          dashboard.
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

      <p className="mt-1 text-sm font-black text-zinc-200">
        {value}
      </p>
    </div>
  );
}
