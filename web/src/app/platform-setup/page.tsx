"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import BN from "bn.js";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import { TxVersion } from "@raydium-io/raydium-sdk-v2";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { KodiakWalletButton } from "@/components/wallet/KodiakWalletButton";
import {
  DEVNET_LAUNCHPAD_PROGRAM_ID,
  loadDevnetRaydium,
} from "@/lib/raydium/devnet";

type SetupStatus =
  | { kind: "idle"; message: string }
  | { kind: "working"; message: string }
  | { kind: "success"; message: string; platformId: string; signature?: string }
  | { kind: "error"; message: string; logs?: string[] };

const PLATFORM_FEE_RATE = 5_000;
const CREATOR_FEE_RATE = 4_500;
const PLATFORM_LP_SCALE = 0;
const CREATOR_LP_SCALE = 100_000;
const BURN_LP_SCALE = 900_000;

export default function PlatformSetupPage() {
  const { connection } = useConnection();
  const {
    connected,
    publicKey,
    signTransaction,
    signAllTransactions,
  } = useWallet();

  const [cpConfigId, setCpConfigId] = useState("");
  const [configOptions, setConfigOptions] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [devnetBalance, setDevnetBalance] = useState<number | null>(null);
  const [status, setStatus] = useState<SetupStatus>({
    kind: "idle",
    message: "Ready for Devnet configuration.",
  });

  useEffect(() => {
    let cancelled = false;

    async function loadBalance() {
      if (!publicKey) {
        setDevnetBalance(null);
        return;
      }

      try {
        const lamports = await connection.getBalance(publicKey, "confirmed");
        if (!cancelled) {
          setDevnetBalance(lamports / LAMPORTS_PER_SOL);
        }
      } catch {
        if (!cancelled) {
          setDevnetBalance(null);
        }
      }
    }

    void loadBalance();

    return () => {
      cancelled = true;
    };
  }, [connection, publicKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadConfigs() {
      try {
        const response = await fetch("/api/raydium/devnet-cpmm-config");
        const data = (await response.json()) as {
          configIds?: string[];
          error?: string;
        };

        if (cancelled) return;

        const ids = data.configIds ?? [];
        setConfigOptions(ids);

        if (ids[0]) {
          setCpConfigId(ids[0]);
        } else if (data.error) {
          setStatus({ kind: "error", message: data.error });
        }
      } catch (error) {
        if (!cancelled) {
          setStatus({
            kind: "error",
            message:
              error instanceof Error
                ? error.message
                : "Unable to load Devnet CPMM configurations.",
          });
        }
      }
    }

    void loadConfigs();

    return () => {
      cancelled = true;
    };
  }, []);

  let cpConfigIsValid = false;

  try {
    cpConfigIsValid =
      new PublicKey(cpConfigId).toBase58() === cpConfigId;
  } catch {
    cpConfigIsValid = false;
  }

  const canCreate =
    connected &&
    Boolean(publicKey) &&
    Boolean(signTransaction) &&
    Boolean(signAllTransactions) &&
    confirmed &&
    cpConfigIsValid &&
    status.kind !== "working";

  async function createPlatform() {
    if (
      !publicKey ||
      !signTransaction ||
      !signAllTransactions ||
      !canCreate
    ) {
      return;
    }

    setStatus({
      kind: "working",
      message: "Building Kodiak PlatformConfig on Solana Devnet...",
    });

    try {
      let cpConfig: PublicKey;

      try {
        cpConfig = new PublicKey(cpConfigId);
      } catch {
        throw new Error(
          "The selected CPMM configuration is not a valid Solana public key.",
        );
      }

      const raydium = await loadDevnetRaydium({
        connection,
        owner: publicKey,
        signTransaction,
        signAllTransactions,
      });

      const { transaction, execute, extInfo } =
        await raydium.launchpad.createPlatformConfig({
          programId: DEVNET_LAUNCHPAD_PROGRAM_ID,
          platformAdmin: publicKey,
          platformClaimFeeWallet: publicKey,
          platformLockNftWallet: publicKey,
          platformVestingWallet: PublicKey.default,
          cpConfigId: cpConfig,
          transferFeeExtensionAuth: publicKey,
          creatorFeeRate: new BN(CREATOR_FEE_RATE),
          migrateCpLockNftScale: {
            platformScale: new BN(PLATFORM_LP_SCALE),
            creatorScale: new BN(CREATOR_LP_SCALE),
            burnScale: new BN(BURN_LP_SCALE),
          },
          feeRate: new BN(PLATFORM_FEE_RATE),
          name: "Kodiak",
          web: window.location.origin,
          img: `${window.location.origin}/kodiak-logo.jpeg`,
          txVersion: TxVersion.V0,
        });

      setStatus({
        kind: "working",
        message: "Simulating the Devnet transaction before opening Phantom...",
      });

      const simulation =
        transaction instanceof VersionedTransaction
          ? await connection.simulateTransaction(transaction, {
              commitment: "confirmed",
              replaceRecentBlockhash: true,
              sigVerify: false,
            })
          : await connection.simulateTransaction(transaction);

      const simulationLogs = simulation.value.logs ?? [];

      if (simulation.value.err) {
        const errorDetails =
          typeof simulation.value.err === "string"
            ? simulation.value.err
            : JSON.stringify(simulation.value.err);

        setStatus({
          kind: "error",
          message: `Devnet simulation failed: ${errorDetails}`,
          logs: simulationLogs,
        });
        return;
      }

      setStatus({
        kind: "working",
        message:
          "Simulation passed. Approve the Devnet transaction in Phantom...",
      });

      const result = await execute({ sendAndConfirm: true });
      const platformId = extInfo.platformId.toBase58();

      window.localStorage.setItem(
        "kodiak-devnet-platform-id",
        platformId,
      );

      const signature =
        typeof result === "string"
          ? result
          : typeof result === "object" &&
              result !== null &&
              "txId" in result &&
              typeof result.txId === "string"
            ? result.txId
            : undefined;

      setStatus({
        kind: "success",
        message: "Kodiak Devnet PlatformConfig created.",
        platformId,
        signature,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Platform creation failed.";

      const possibleLogs =
        typeof error === "object" &&
        error !== null &&
        "logs" in error &&
        Array.isArray(error.logs)
          ? error.logs.filter(
              (item): item is string => typeof item === "string",
            )
          : undefined;

      setStatus({
        kind: "error",
        message:
          message.includes("already") ||
          message.includes("initialized")
            ? `${message} This wallet may already own a platform configuration.`
            : message,
        logs: possibleLogs,
      });
    }
  }

  return (
    <main className="min-h-screen bg-[#070707] px-5 py-8 text-zinc-100 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col justify-between gap-5 sm:flex-row">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.24em] text-emerald-300">
              Devnet launch engine
            </p>
            <h1 className="mt-3 text-4xl font-black sm:text-5xl">
              Register Kodiak
            </h1>
            <p className="mt-4 max-w-2xl leading-7 text-zinc-400">
              Create Kodiak&apos;s one-time Raydium LaunchLab PlatformConfig
              using test-network SOL only.
            </p>
          </div>

          <Link
            href="/dashboard"
            className="h-fit w-fit rounded-xl border border-white/10 px-4 py-2 text-sm font-bold"
          >
            Back to dashboard
          </Link>
        </div>

        <div className="mt-9 grid gap-6 lg:grid-cols-[1fr_.85fr]">
          <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 sm:p-8">
            <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-5">
              <p className="font-black text-amber-300">Devnet only</p>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                This page is hard-wired to Raydium&apos;s Devnet LaunchLab
                program. Phantom will ask you to approve a test transaction.
              </p>
            </div>

            <div className="mt-7 space-y-5">
              <div>
                <p className="text-sm font-bold text-zinc-400">
                  Administrator and fee wallet
                </p>
                <p className="mt-2 break-all rounded-2xl bg-black/25 p-4 font-mono text-sm text-emerald-300">
                  {publicKey?.toBase58() ?? "Connect a wallet"}
                </p>
                <p className="mt-3 text-sm text-zinc-400">
                  Devnet balance:{" "}
                  <span className="font-bold text-zinc-100">
                    {devnetBalance === null
                      ? "Checking..."
                      : `${devnetBalance.toFixed(4)} SOL`}
                  </span>
                </p>

                {devnetBalance !== null && devnetBalance < 0.01 && (
                  <p className="mt-2 text-sm font-bold text-amber-300">
                    This wallet may need more Devnet SOL to create the
                    PlatformConfig account.
                  </p>
                )}
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-bold text-zinc-300">
                  Devnet CPMM configuration
                </span>

                {configOptions.length > 0 ? (
                  <select
                    value={cpConfigId}
                    onChange={(event) =>
                      setCpConfigId(event.target.value)
                    }
                    className="w-full rounded-2xl border border-white/10 bg-zinc-950 px-4 py-4 text-sm"
                  >
                    {configOptions.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={cpConfigId}
                    onChange={(event) =>
                      setCpConfigId(event.target.value)
                    }
                    placeholder="Paste a Devnet CPMM config ID"
                    className="w-full rounded-2xl border border-white/10 bg-zinc-950 px-4 py-4 text-sm"
                  />
                )}

                {cpConfigId && !cpConfigIsValid && (
                  <p className="mt-2 text-sm font-bold text-red-300">
                    This is not a valid Solana CPMM configuration address.
                  </p>
                )}
              </label>

              <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 p-5">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) =>
                    setConfirmed(event.target.checked)
                  }
                  className="mt-1 h-5 w-5 accent-emerald-400"
                />
                <span className="text-sm leading-6 text-zinc-400">
                  I understand this creates a one-time on-chain configuration
                  tied to my connected wallet and uses Devnet SOL.
                </span>
              </label>

              {!connected ? (
                <div className="flex justify-center">
                  <KodiakWalletButton />
                </div>
              ) : (
                <button
                  type="button"
                  disabled={!canCreate}
                  onClick={() => void createPlatform()}
                  className="w-full rounded-2xl bg-gradient-to-r from-emerald-400 to-amber-300 px-6 py-4 text-lg font-black text-black disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  {status.kind === "working"
                    ? "Waiting for transaction..."
                    : "Create Kodiak Devnet Platform"}
                </button>
              )}
            </div>
          </section>

          <aside className="space-y-5">
            <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-black">On-chain settings</h2>

              <div className="mt-5 space-y-4 text-sm">
                {[
                  ["Kodiak platform fee", "0.60%"],
                  ["Creator curve fee", "0.45%"],
                  ["Migrated LP burned", "90%"],
                  ["Creator Fee Key share", "10%"],
                  ["Platform LP share", "0%"],
                  ["LP scale total", "1,000,000 / 1,000,000"],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex justify-between gap-5 border-b border-white/5 pb-3 last:border-0"
                  >
                    <span className="text-zinc-500">{label}</span>
                    <span className="text-right font-bold">{value}</span>
                  </div>
                ))}
              </div>
            </section>

            <section
              className={`rounded-[2rem] border p-6 ${
                status.kind === "error"
                  ? "border-red-400/20 bg-red-400/[0.05]"
                  : status.kind === "success"
                    ? "border-emerald-400/20 bg-emerald-400/[0.05]"
                    : "border-white/10 bg-white/[0.025]"
              }`}
            >
              <p className="text-sm font-black uppercase tracking-[0.16em] text-zinc-500">
                Status
              </p>

              <p className="mt-3 break-words font-bold">
                {status.message}
              </p>

              {status.kind === "error" &&
                status.logs &&
                status.logs.length > 0 && (
                  <div className="mt-5">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-red-300">
                      Solana simulation logs
                    </p>
                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/40 p-4 text-[11px] leading-5 text-zinc-300">
                      {status.logs.join("\n")}
                    </pre>
                  </div>
                )}

              {status.kind === "success" && (
                <div className="mt-5">
                  <p className="text-xs text-zinc-500">
                    PlatformConfig address
                  </p>
                  <p className="mt-2 break-all rounded-xl bg-black/30 p-3 font-mono text-xs text-emerald-300">
                    {status.platformId}
                  </p>

                  {status.signature && (
                    <a
                      href={`https://explorer.solana.com/tx/${status.signature}?cluster=devnet`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-block text-sm font-bold text-amber-300"
                    >
                      View transaction
                    </a>
                  )}
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
