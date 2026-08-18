"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import BN from "bn.js";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  LAUNCHPAD_PROGRAM,
  PlatformConfig,
  TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import {
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";

import { KodiakWalletButton } from "@/components/wallet/KodiakWalletButton";
import { KODIAK_FEE_LABELS } from "@/lib/fees";
import {
  KODIAK_LAUNCHPAD_PROGRAM_ID,
  loadKodiakRaydium,
} from "@/lib/raydium/devnet";
import {
  KODIAK_IS_DEVNET,
  KODIAK_IS_MAINNET,
  KODIAK_MAINNET_CPMM_CONFIG_ID,
  KODIAK_MAINNET_REQUESTED_BUT_LOCKED,
  kodiakExplorerAddressUrl,
  kodiakExplorerTransactionUrl,
  kodiakNetworkLabel,
} from "@/lib/solana/network";

type SetupStatus =
  | {
      kind: "idle";
      message: string;
    }
  | {
      kind: "working";
      message: string;
    }
  | {
      kind: "success";
      message: string;
      platformId: string;
      signature?: string;
    }
  | {
      kind: "error";
      message: string;
      logs?: string[];
    };

type MainnetVerification = {
  checked: boolean;
  accountExists: boolean;
  ownerMatchesLaunchLab: boolean;
  cpmmMatches: boolean;
  platformFeeMatches: boolean;
  creatorFeeMatches: boolean;
  actualCpmmConfig: string | null;
  actualPlatformFeeRate: string | null;
  actualCreatorFeeRate: string | null;
};

const PLATFORM_FEE_RATE = 5_000;
const CREATOR_FEE_RATE = 4_500;
const PLATFORM_LP_SCALE = 0;
const CREATOR_LP_SCALE = 100_000;
const BURN_LP_SCALE = 900_000;

const MAINNET_PLATFORM_ID =
  "5d63yX2vRpyS2BPFwJJB15tMmctWCKwiKychEjP3gy4W";

const NETWORK_LABEL = kodiakNetworkLabel();

const MAINNET_PLATFORM_ADMIN_WALLET =
  process.env.NEXT_PUBLIC_KODIAK_PLATFORM_ADMIN_WALLET?.trim() ?? "";

const MAINNET_PLATFORM_CLAIM_FEE_WALLET =
  process.env.NEXT_PUBLIC_KODIAK_PLATFORM_CLAIM_FEE_WALLET?.trim() ?? "";

const MAINNET_PLATFORM_LOCK_NFT_WALLET =
  process.env.NEXT_PUBLIC_KODIAK_PLATFORM_LOCK_NFT_WALLET?.trim() ?? "";

const MAINNET_TRANSFER_FEE_AUTH_WALLET =
  process.env.NEXT_PUBLIC_KODIAK_TRANSFER_FEE_AUTH_WALLET?.trim() ?? "";

const MAINNET_SETUP_ENABLED =
  process.env.NEXT_PUBLIC_KODIAK_MAINNET_SETUP_ENABLED
    ?.trim()
    .toLowerCase() === "true";

const MAINNET_SETUP_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL?.trim() ?? "";

const MAINNET_SETUP_READY =
  KODIAK_MAINNET_REQUESTED_BUT_LOCKED &&
  MAINNET_SETUP_ENABLED &&
  Boolean(MAINNET_SETUP_RPC_URL);

function validConfiguredPublicKey(value: string) {
  if (!value) return false;

  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

const MAINNET_AUTHORITY_CONFIG_READY =
  validConfiguredPublicKey(MAINNET_PLATFORM_ADMIN_WALLET) &&
  validConfiguredPublicKey(MAINNET_PLATFORM_CLAIM_FEE_WALLET) &&
  validConfiguredPublicKey(MAINNET_PLATFORM_LOCK_NFT_WALLET) &&
  validConfiguredPublicKey(MAINNET_TRANSFER_FEE_AUTH_WALLET);

const MAINNET_CPMM_CONFIG_READY =
  validConfiguredPublicKey(KODIAK_MAINNET_CPMM_CONFIG_ID);

function bnLikeToString(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "toString" in value &&
    typeof value.toString === "function"
  ) {
    return value.toString();
  }

  return null;
}

export default function PlatformSetupPage() {
  const { connection } = useConnection();

  const {
    connected,
    publicKey,
    signTransaction,
    signAllTransactions,
  } = useWallet();

  const mainnetSetupConnection =
    MAINNET_SETUP_READY
      ? new Connection(
          MAINNET_SETUP_RPC_URL,
          "confirmed",
        )
      : null;

  const isolatedMainnetSetup =
    Boolean(mainnetSetupConnection);

  const [
    cpConfigId,
    setCpConfigId,
  ] = useState("");

  const [
    configOptions,
    setConfigOptions,
  ] = useState<string[]>([]);

  const [
    confirmed,
    setConfirmed,
  ] = useState(false);

  const [
    networkBalance,
    setNetworkBalance,
  ] = useState<number | null>(null);

  const [
    verification,
    setVerification,
  ] = useState<MainnetVerification | null>(null);

  const [
    status,
    setStatus,
  ] = useState<SetupStatus>({
    kind: "idle",
    message: KODIAK_MAINNET_REQUESTED_BUT_LOCKED
      ? "Mainnet is requested, but Kodiak remains safely locked to Devnet. This page is verification-only for the existing Mainnet PlatformConfig."
      : KODIAK_IS_DEVNET
        ? "Ready for Devnet configuration."
        : "Kodiak Mainnet is enabled. PlatformConfig creation is permanently disabled on this page.",
  });

  async function verifyExistingMainnetPlatform() {
    if (!mainnetSetupConnection) {
      setVerification(null);

      setStatus({
        kind: "error",
        message:
          "Kodiak's isolated Mainnet verification RPC is not available.",
      });

      return;
    }

    try {
      setStatus({
        kind: "working",
        message:
          "Reading Kodiak's existing Mainnet PlatformConfig directly from Solana...",
      });

      const platformId =
        new PublicKey(
          MAINNET_PLATFORM_ID,
        );

      const account =
        await mainnetSetupConnection.getAccountInfo(
          platformId,
          "confirmed",
        );

      if (!account) {
        setVerification({
          checked: true,
          accountExists: false,
          ownerMatchesLaunchLab: false,
          cpmmMatches: false,
          platformFeeMatches: false,
          creatorFeeMatches: false,
          actualCpmmConfig: null,
          actualPlatformFeeRate: null,
          actualCreatorFeeRate: null,
        });

        setStatus({
          kind: "error",
          message:
            "Kodiak's expected Mainnet PlatformConfig account was not found. Mainnet must remain locked.",
        });

        return;
      }

      const ownerMatchesLaunchLab =
        account.owner.equals(
          LAUNCHPAD_PROGRAM,
        );

      const decoded =
        PlatformConfig.decode(
          account.data,
        ) as unknown as {
          cpConfigId?: PublicKey;
          feeRate?: unknown;
          creatorFeeRate?: unknown;
        };

      const actualCpmmConfig =
        decoded.cpConfigId instanceof PublicKey
          ? decoded.cpConfigId.toBase58()
          : null;

      const actualPlatformFeeRate =
        bnLikeToString(
          decoded.feeRate,
        );

      const actualCreatorFeeRate =
        bnLikeToString(
          decoded.creatorFeeRate,
        );

      const cpmmMatches =
        actualCpmmConfig ===
        KODIAK_MAINNET_CPMM_CONFIG_ID;

      const platformFeeMatches =
        actualPlatformFeeRate ===
        String(
          PLATFORM_FEE_RATE,
        );

      const creatorFeeMatches =
        actualCreatorFeeRate ===
        String(
          CREATOR_FEE_RATE,
        );

      const nextVerification: MainnetVerification = {
        checked: true,
        accountExists: true,
        ownerMatchesLaunchLab,
        cpmmMatches,
        platformFeeMatches,
        creatorFeeMatches,
        actualCpmmConfig,
        actualPlatformFeeRate,
        actualCreatorFeeRate,
      };

      setVerification(
        nextVerification,
      );

      const verified =
        ownerMatchesLaunchLab &&
        cpmmMatches &&
        platformFeeMatches &&
        creatorFeeMatches;

      if (!verified) {
        setStatus({
          kind: "error",
          message:
            "Kodiak's Mainnet PlatformConfig exists, but one or more critical on-chain values do not match the production configuration. Mainnet must remain locked.",
        });

        return;
      }

      setStatus({
        kind: "success",
        message:
          "Existing Kodiak Mainnet PlatformConfig verified on-chain. CPMM index and fee settings match the production configuration. No Mainnet setup transaction is available from this page.",
        platformId:
          platformId.toBase58(),
      });
    } catch (error) {
      setVerification(null);

      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to verify Kodiak's existing Mainnet PlatformConfig.",
      });
    }
  }

  useEffect(() => {
    if (!isolatedMainnetSetup) {
      return;
    }

    const timer =
      window.setTimeout(
        () => {
          void verifyExistingMainnetPlatform();
        },
        0,
      );

    return () =>
      window.clearTimeout(
        timer,
      );
  }, [isolatedMainnetSetup]);

  useEffect(() => {
    let cancelled = false;

    async function loadBalance() {
      if (
        !publicKey ||
        isolatedMainnetSetup
      ) {
        setNetworkBalance(null);
        return;
      }

      try {
        const lamports =
          await connection.getBalance(
            publicKey,
            "confirmed",
          );

        if (!cancelled) {
          setNetworkBalance(
            lamports /
              LAMPORTS_PER_SOL,
          );
        }
      } catch {
        if (!cancelled) {
          setNetworkBalance(
            null,
          );
        }
      }
    }

    void loadBalance();

    return () => {
      cancelled = true;
    };
  }, [
    connection,
    isolatedMainnetSetup,
    publicKey,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadConfigs() {
      /*
       * Mainnet is verification-only. The existing Mainnet PlatformConfig
       * already exists and must never be recreated from this page.
       */
      if (
        isolatedMainnetSetup ||
        KODIAK_IS_MAINNET
      ) {
        setConfigOptions([]);
        setCpConfigId(
          KODIAK_MAINNET_CPMM_CONFIG_ID,
        );
        return;
      }

      try {
        const response =
          await fetch(
            "/api/raydium/devnet-cpmm-config",
          );

        const data =
          (await response.json()) as {
            configIds?: string[];
            error?: string;
          };

        if (cancelled) {
          return;
        }

        const ids =
          data.configIds ?? [];

        setConfigOptions(ids);

        if (ids[0]) {
          setCpConfigId(
            ids[0],
          );
        } else if (
          data.error
        ) {
          setStatus({
            kind: "error",
            message:
              data.error,
          });
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
  }, [isolatedMainnetSetup]);

  let cpConfigIsValid = false;

  try {
    cpConfigIsValid =
      new PublicKey(
        cpConfigId,
      ).toBase58() ===
      cpConfigId;
  } catch {
    cpConfigIsValid =
      false;
  }

  const canCreateDevnet =
    KODIAK_IS_DEVNET &&
    !isolatedMainnetSetup &&
    connected &&
    Boolean(publicKey) &&
    Boolean(signTransaction) &&
    Boolean(signAllTransactions) &&
    confirmed &&
    cpConfigIsValid &&
    status.kind !==
      "working";

  async function createDevnetPlatform() {
    if (
      !publicKey ||
      !signTransaction ||
      !signAllTransactions ||
      !canCreateDevnet
    ) {
      return;
    }

    try {
      setStatus({
        kind: "working",
        message:
          "Building Kodiak PlatformConfig on Solana Devnet...",
      });

      const cpConfig =
        new PublicKey(
          cpConfigId,
        );

      const raydium =
        await loadKodiakRaydium({
          connection,
          owner:
            publicKey,
          signTransaction,
          signAllTransactions,
        });

      const {
        transaction,
        execute,
        extInfo,
      } =
        await raydium.launchpad.createPlatformConfig(
          {
            programId:
              KODIAK_LAUNCHPAD_PROGRAM_ID,
            platformAdmin:
              publicKey,
            platformClaimFeeWallet:
              publicKey,
            platformLockNftWallet:
              publicKey,
            platformVestingWallet:
              PublicKey.default,
            cpConfigId:
              cpConfig,
            transferFeeExtensionAuth:
              publicKey,
            creatorFeeRate:
              new BN(
                CREATOR_FEE_RATE,
              ),
            migrateCpLockNftScale:
              {
                platformScale:
                  new BN(
                    PLATFORM_LP_SCALE,
                  ),
                creatorScale:
                  new BN(
                    CREATOR_LP_SCALE,
                  ),
                burnScale:
                  new BN(
                    BURN_LP_SCALE,
                  ),
              },
            feeRate:
              new BN(
                PLATFORM_FEE_RATE,
              ),
            name:
              "Kodiak",
            web:
              window.location
                .origin,
            img:
              `${window.location.origin}/kodiak-logo.jpeg`,
            txVersion:
              TxVersion.V0,
          },
        );

      setStatus({
        kind: "working",
        message:
          "Simulating the Devnet transaction before opening your wallet...",
      });

      const simulation =
        transaction instanceof
        VersionedTransaction
          ? await connection.simulateTransaction(
              transaction,
              {
                commitment:
                  "confirmed",
                replaceRecentBlockhash:
                  true,
                sigVerify:
                  false,
              },
            )
          : await connection.simulateTransaction(
              transaction,
            );

      const simulationLogs =
        simulation.value.logs ??
        [];

      if (
        simulation.value.err
      ) {
        setStatus({
          kind: "error",
          message:
            `Devnet simulation failed: ${JSON.stringify(
              simulation.value.err,
            )}`,
          logs:
            simulationLogs,
        });

        return;
      }

      setStatus({
        kind: "working",
        message:
          "Simulation passed. Approve the Devnet transaction in your wallet...",
      });

      const result =
        await execute({
          sendAndConfirm:
            true,
        });

      const platformId =
        extInfo.platformId.toBase58();

      window.localStorage.setItem(
        "kodiak-devnet-platform-id",
        platformId,
      );

      const signature =
        typeof result ===
        "string"
          ? result
          : typeof result ===
                "object" &&
              result !==
                null &&
              "txId" in
                result &&
              typeof result.txId ===
                "string"
            ? result.txId
            : undefined;

      setStatus({
        kind: "success",
        message:
          "Kodiak Devnet PlatformConfig created.",
        platformId,
        signature,
      });
    } catch (error) {
      const possibleLogs =
        typeof error ===
          "object" &&
        error !== null &&
        "logs" in error &&
        Array.isArray(
          error.logs,
        )
          ? error.logs.filter(
              (
                item,
              ): item is string =>
                typeof item ===
                "string",
            )
          : undefined;

      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Devnet PlatformConfig creation failed.",
        logs:
          possibleLogs,
      });
    }
  }

  const mainnetVerificationPassed =
    Boolean(
      verification?.accountExists &&
      verification?.ownerMatchesLaunchLab &&
      verification?.cpmmMatches &&
      verification?.platformFeeMatches &&
      verification?.creatorFeeMatches,
    );

  return (
    <main className="min-h-screen bg-[#070707] px-5 py-8 text-zinc-100 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col justify-between gap-5 sm:flex-row">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.24em] text-emerald-300">
              {KODIAK_MAINNET_REQUESTED_BUT_LOCKED
                ? "Mainnet requested - Devnet safe mode"
                : `${NETWORK_LABEL} launch engine`}
            </p>

            <h1 className="mt-3 text-4xl font-black sm:text-5xl">
              {isolatedMainnetSetup ||
              KODIAK_IS_MAINNET
                ? "Verify Kodiak"
                : "Register Kodiak"}
            </h1>

            <p className="mt-4 max-w-2xl leading-7 text-zinc-400">
              {isolatedMainnetSetup
                ? "Read-only verification of Kodiak's existing Mainnet Raydium LaunchLab PlatformConfig. This page cannot create, update, or replace the Mainnet PlatformConfig."
                : KODIAK_IS_MAINNET
                  ? "Kodiak Mainnet is active. PlatformConfig creation is permanently disabled on this page."
                  : "Create Kodiak's one-time Raydium LaunchLab PlatformConfig using test-network SOL only."}
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
            {isolatedMainnetSetup ? (
              <>
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-black text-emerald-300">
                        Existing Mainnet PlatformConfig
                      </p>
                      <p className="mt-2 text-sm leading-6 text-zinc-400">
                        Verification only. No wallet signature and no Mainnet transaction can be produced from this page.
                      </p>
                    </div>

                    <span
                      className={`rounded-full px-3 py-1 text-xs font-black ${
                        mainnetVerificationPassed
                          ? "bg-emerald-400/10 text-emerald-300"
                          : status.kind === "working"
                            ? "bg-amber-300/10 text-amber-300"
                            : "bg-red-400/10 text-red-300"
                      }`}
                    >
                      {mainnetVerificationPassed
                        ? "VERIFIED"
                        : status.kind === "working"
                          ? "CHECKING"
                          : "NOT VERIFIED"}
                    </span>
                  </div>

                  <div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-zinc-500">
                      Mainnet PlatformConfig
                    </p>

                    <p className="mt-2 break-all font-mono text-sm text-emerald-300">
                      {MAINNET_PLATFORM_ID}
                    </p>

                    <a
                      href={kodiakExplorerAddressUrl(
                        MAINNET_PLATFORM_ID,
                      )}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-block text-xs font-black text-amber-300"
                    >
                      View PlatformConfig on Solana Explorer
                    </a>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      void verifyExistingMainnetPlatform()
                    }
                    disabled={
                      status.kind ===
                      "working"
                    }
                    className="mt-4 w-full rounded-xl border border-emerald-400/30 px-5 py-3 text-sm font-black text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {status.kind ===
                    "working"
                      ? "Verifying on-chain..."
                      : "Refresh Mainnet verification"}
                  </button>
                </div>

                <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-5">
                  <div className="flex items-center justify-between gap-4">
                    <p className="font-black text-zinc-200">
                      Production authority configuration
                    </p>

                    <span
                      className={`rounded-full px-3 py-1 text-xs font-black ${
                        MAINNET_AUTHORITY_CONFIG_READY &&
                        MAINNET_CPMM_CONFIG_READY
                          ? "bg-emerald-400/10 text-emerald-300"
                          : "bg-amber-300/10 text-amber-300"
                      }`}
                    >
                      {MAINNET_AUTHORITY_CONFIG_READY &&
                      MAINNET_CPMM_CONFIG_READY
                        ? "CONFIGURED"
                        : "INCOMPLETE"}
                    </span>
                  </div>

                  <p className="mt-3 text-xs leading-5 text-zinc-500">
                    These are Kodiak&apos;s configured production authorities. The read-only check above independently verifies the PlatformConfig account, LaunchLab ownership, CPMM target, and fee rates.
                  </p>

                  <div className="mt-4 space-y-3 text-xs">
                    {[
                      [
                        "Platform admin",
                        MAINNET_PLATFORM_ADMIN_WALLET,
                      ],
                      [
                        "Platform fee-claim wallet",
                        MAINNET_PLATFORM_CLAIM_FEE_WALLET,
                      ],
                      [
                        "Platform lock-NFT wallet",
                        MAINNET_PLATFORM_LOCK_NFT_WALLET,
                      ],
                      [
                        "Transfer-fee authority",
                        MAINNET_TRANSFER_FEE_AUTH_WALLET,
                      ],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3"
                      >
                        <p className="font-bold text-zinc-500">
                          {label}
                        </p>
                        <p className="mt-1 break-all font-mono text-zinc-300">
                          {value || "Not configured"}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-5">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">
                    On-chain verification
                  </p>

                  <div className="mt-4 space-y-3 text-sm">
                    {[
                      [
                        "PlatformConfig exists",
                        verification?.accountExists,
                      ],
                      [
                        "Owned by Raydium LaunchLab",
                        verification?.ownerMatchesLaunchLab,
                      ],
                      [
                        "CPMM index 8 config",
                        verification?.cpmmMatches,
                      ],
                      [
                        "Kodiak fee = 0.50%",
                        verification?.platformFeeMatches,
                      ],
                      [
                        "Creator curve fee = 0.45%",
                        verification?.creatorFeeMatches,
                      ],
                    ].map(([label, passed]) => (
                      <div
                        key={String(label)}
                        className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-3"
                      >
                        <span className="text-zinc-400">
                          {String(label)}
                        </span>

                        <span
                          className={`font-black ${
                            passed === true
                              ? "text-emerald-300"
                              : passed === false
                                ? "text-red-300"
                                : "text-zinc-600"
                          }`}
                        >
                          {passed === true
                            ? "PASS"
                            : passed === false
                              ? "FAIL"
                              : "WAITING"}
                        </span>
                      </div>
                    ))}
                  </div>

                  {verification?.actualCpmmConfig && (
                    <p className="mt-4 break-all text-xs text-zinc-500">
                      On-chain CPMM config:{" "}
                      <span className="font-mono text-zinc-300">
                        {verification.actualCpmmConfig}
                      </span>
                    </p>
                  )}
                </div>
              </>
            ) : KODIAK_IS_MAINNET ? (
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] p-5">
                <p className="font-black text-emerald-300">
                  Mainnet PlatformConfig creation disabled
                </p>

                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  Kodiak already has its production PlatformConfig. This page contains no Mainnet creation or update transaction path.
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-5">
                  <p className="font-black text-amber-300">
                    Devnet only
                  </p>

                  <p className="mt-2 text-sm leading-6 text-zinc-400">
                    Devnet PlatformConfig creation remains available for test-network development. This cannot create a Mainnet PlatformConfig.
                  </p>
                </div>

                <div className="mt-7 space-y-5">
                  <div>
                    <p className="text-sm font-bold text-zinc-400">
                      Transaction signer
                    </p>

                    <p className="mt-2 break-all rounded-2xl bg-black/25 p-4 font-mono text-sm text-emerald-300">
                      {publicKey?.toBase58() ??
                        "Connect a wallet"}
                    </p>

                    <p className="mt-3 text-sm text-zinc-400">
                      Devnet balance:{" "}
                      <span className="font-bold text-zinc-100">
                        {networkBalance ===
                        null
                          ? "Checking..."
                          : `${networkBalance.toFixed(
                              4,
                            )} SOL`}
                      </span>
                    </p>
                  </div>

                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-zinc-300">
                      Devnet CPMM configuration
                    </span>

                    {configOptions.length >
                    0 ? (
                      <select
                        value={
                          cpConfigId
                        }
                        onChange={(
                          event,
                        ) =>
                          setCpConfigId(
                            event.target
                              .value,
                          )
                        }
                        className="w-full rounded-2xl border border-white/10 bg-zinc-950 px-4 py-4 text-sm"
                      >
                        {configOptions.map(
                          (id) => (
                            <option
                              key={
                                id
                              }
                              value={
                                id
                              }
                            >
                              {id}
                            </option>
                          ),
                        )}
                      </select>
                    ) : (
                      <input
                        value={
                          cpConfigId
                        }
                        onChange={(
                          event,
                        ) =>
                          setCpConfigId(
                            event.target
                              .value,
                          )
                        }
                        placeholder="Paste a Devnet CPMM config ID"
                        className="w-full rounded-2xl border border-white/10 bg-zinc-950 px-4 py-4 text-sm"
                      />
                    )}

                    {cpConfigId &&
                      !cpConfigIsValid && (
                        <p className="mt-2 text-sm font-bold text-red-300">
                          This is not a valid Solana CPMM configuration address.
                        </p>
                      )}
                  </label>

                  <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 p-5">
                    <input
                      type="checkbox"
                      checked={
                        confirmed
                      }
                      onChange={(
                        event,
                      ) =>
                        setConfirmed(
                          event.target
                            .checked,
                        )
                      }
                      className="mt-1 h-5 w-5 accent-emerald-400"
                    />

                    <span className="text-sm leading-6 text-zinc-400">
                      I understand this creates a one-time on-chain configuration tied to my connected wallet and uses Devnet SOL.
                    </span>
                  </label>

                  {!connected ? (
                    <div className="flex justify-center">
                      <KodiakWalletButton />
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={
                        !canCreateDevnet
                      }
                      onClick={() =>
                        void createDevnetPlatform()
                      }
                      className="w-full rounded-2xl bg-gradient-to-r from-emerald-400 to-amber-300 px-6 py-4 text-lg font-black text-black disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                    >
                      {status.kind ===
                      "working"
                        ? "Waiting for transaction..."
                        : "Create Kodiak Devnet Platform"}
                    </button>
                  )}
                </div>
              </>
            )}
          </section>

          <aside className="space-y-5">
            <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-black">
                Production settings
              </h2>

              <div className="mt-5 space-y-4 text-sm">
                {[
                  [
                    "Kodiak platform fee",
                    KODIAK_FEE_LABELS.kodiakPlatform,
                  ],
                  [
                    "Creator curve fee",
                    KODIAK_FEE_LABELS.creatorCurve,
                  ],
                  [
                    "Migrated LP burned",
                    KODIAK_FEE_LABELS.migratedLpBurn,
                  ],
                  [
                    "Creator Fee Key share",
                    KODIAK_FEE_LABELS.creatorFeeKeyLpShare,
                  ],
                  [
                    "Platform LP share",
                    KODIAK_FEE_LABELS.platformLpShare,
                  ],
                  [
                    "LP scale total",
                    "1,000,000 / 1,000,000",
                  ],
                ].map(
                  ([
                    label,
                    value,
                  ]) => (
                    <div
                      key={
                        label
                      }
                      className="flex justify-between gap-5 border-b border-white/5 pb-3 last:border-0"
                    >
                      <span className="text-zinc-500">
                        {label}
                      </span>

                      <span className="text-right font-bold">
                        {value}
                      </span>
                    </div>
                  ),
                )}
              </div>
            </section>

            <section
              className={`rounded-[2rem] border p-6 ${
                status.kind ===
                "error"
                  ? "border-red-400/20 bg-red-400/[0.05]"
                  : status.kind ===
                      "success"
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

              {status.kind ===
                "error" &&
                status.logs &&
                status.logs
                  .length >
                  0 && (
                  <div className="mt-5">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-red-300">
                      Solana simulation logs
                    </p>

                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/40 p-4 text-[11px] leading-5 text-zinc-300">
                      {status.logs.join(
                        "\n",
                      )}
                    </pre>
                  </div>
                )}

              {status.kind ===
                "success" && (
                <div className="mt-5">
                  <p className="text-xs text-zinc-500">
                    PlatformConfig address
                  </p>

                  <p className="mt-2 break-all rounded-xl bg-black/30 p-3 font-mono text-xs text-emerald-300">
                    {
                      status.platformId
                    }
                  </p>

                  {status.signature && (
                    <a
                      href={kodiakExplorerTransactionUrl(
                        status.signature,
                      )}
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
