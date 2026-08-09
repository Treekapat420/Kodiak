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
  Raydium,
  TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import {
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";

import { KodiakWalletButton } from "@/components/wallet/KodiakWalletButton";
import {
  KODIAK_LAUNCHPAD_PROGRAM_ID,
  loadKodiakRaydium,
} from "@/lib/raydium/devnet";
import {
  KODIAK_IS_DEVNET,
  KODIAK_IS_MAINNET,
  KODIAK_MAINNET_CPMM_CONFIG_ID,
  KODIAK_MAINNET_REQUESTED_BUT_LOCKED,
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

type PlatformAuthorities = {
  platformAdmin: PublicKey;
  platformClaimFeeWallet: PublicKey;
  platformLockNftWallet: PublicKey;
  transferFeeExtensionAuth: PublicKey;
};

const PLATFORM_FEE_RATE = 5_000;
const CREATOR_FEE_RATE = 4_500;
const PLATFORM_LP_SCALE = 0;
const CREATOR_LP_SCALE = 100_000;
const BURN_LP_SCALE = 900_000;

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

function getMainnetAuthorities(): PlatformAuthorities {
  if (!MAINNET_AUTHORITY_CONFIG_READY) {
    throw new Error(
      "Kodiak Mainnet authority configuration is incomplete.",
    );
  }

  return {
    platformAdmin: new PublicKey(
      MAINNET_PLATFORM_ADMIN_WALLET,
    ),
    platformClaimFeeWallet: new PublicKey(
      MAINNET_PLATFORM_CLAIM_FEE_WALLET,
    ),
    platformLockNftWallet: new PublicKey(
      MAINNET_PLATFORM_LOCK_NFT_WALLET,
    ),
    transferFeeExtensionAuth: new PublicKey(
      MAINNET_TRANSFER_FEE_AUTH_WALLET,
    ),
  };
}

export default function PlatformSetupPage() {
  const { connection } = useConnection();

  const mainnetSetupConnection =
    MAINNET_SETUP_READY
      ? new Connection(
          MAINNET_SETUP_RPC_URL,
          "confirmed",
        )
      : null;

  const activeSetupConnection =
    mainnetSetupConnection ??
    connection;

  const isolatedMainnetSetup =
    Boolean(
      mainnetSetupConnection,
    );

  const {
    connected,
    publicKey,
    signTransaction,
    signAllTransactions,
  } = useWallet();

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
    status,
    setStatus,
  ] = useState<SetupStatus>({
    kind: "idle",
    message: KODIAK_MAINNET_REQUESTED_BUT_LOCKED
      ? "Mainnet is requested, but Kodiak is safely locked to Devnet until the explicit Mainnet enable flag is turned on."
      : KODIAK_IS_DEVNET
        ? "Ready for Devnet configuration."
        : "Mainnet Platform Setup is locked until Kodiak's production configuration is intentionally prepared.",
  });

  useEffect(() => {
    let cancelled = false;

    async function loadBalance() {
      if (!publicKey) {
        setNetworkBalance(null);
        return;
      }

      try {
        const lamports =
          await activeSetupConnection.getBalance(
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
    activeSetupConnection,
    publicKey,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadConfigs() {
      if (isolatedMainnetSetup) {
        setConfigOptions([]);
        setCpConfigId(
          KODIAK_MAINNET_CPMM_CONFIG_ID,
        );

        setStatus({
          kind: "idle",
          message:
            "Isolated Mainnet PlatformConfig setup is armed. The rest of Kodiak remains on Devnet.",
        });

        return;
      }

      if (KODIAK_IS_MAINNET) {
        setConfigOptions([]);
        setCpConfigId(
          KODIAK_MAINNET_CPMM_CONFIG_ID,
        );

        setStatus({
          kind: "idle",
          message:
            "Kodiak's verified Mainnet CPMM configuration is loaded, but Mainnet PlatformConfig creation remains locked.",
        });

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

  const signerMatchesMainnetAdmin =
    Boolean(publicKey) &&
    validConfiguredPublicKey(
      MAINNET_PLATFORM_ADMIN_WALLET,
    ) &&
    publicKey?.toBase58() ===
      MAINNET_PLATFORM_ADMIN_WALLET;

  const commonCreateRequirements =
    connected &&
    Boolean(publicKey) &&
    Boolean(signTransaction) &&
    Boolean(signAllTransactions) &&
    confirmed &&
    cpConfigIsValid &&
    status.kind !==
      "working";

  const canCreateDevnet =
    KODIAK_IS_DEVNET &&
    !isolatedMainnetSetup &&
    commonCreateRequirements;

  const canCreateIsolatedMainnet =
    isolatedMainnetSetup &&
    MAINNET_AUTHORITY_CONFIG_READY &&
    MAINNET_CPMM_CONFIG_READY &&
    signerMatchesMainnetAdmin &&
    commonCreateRequirements;

  const canCreate =
    canCreateDevnet ||
    canCreateIsolatedMainnet;

  async function createPlatform() {
    if (
      !publicKey ||
      !signTransaction ||
      !signAllTransactions ||
      !canCreate
    ) {
      return;
    }

    const targetIsMainnet =
      isolatedMainnetSetup;

    const targetLabel =
      targetIsMainnet
        ? "Mainnet"
        : "Devnet";

    setStatus({
      kind: "working",
      message:
        `Building Kodiak PlatformConfig on Solana ${targetLabel}...`,
    });

    try {
      const cpConfig =
        targetIsMainnet
          ? new PublicKey(
              KODIAK_MAINNET_CPMM_CONFIG_ID,
            )
          : new PublicKey(
              cpConfigId,
            );

      const authorities:
        PlatformAuthorities =
        targetIsMainnet
          ? getMainnetAuthorities()
          : {
              platformAdmin:
                publicKey,
              platformClaimFeeWallet:
                publicKey,
              platformLockNftWallet:
                publicKey,
              transferFeeExtensionAuth:
                publicKey,
            };

      /*
       * When Mainnet is eventually unlocked, the connected transaction
       * signer must be Kodiak's configured platform admin.
       */
      if (
        targetIsMainnet &&
        !publicKey.equals(
          authorities.platformAdmin,
        )
      ) {
        throw new Error(
          "Connect the configured Kodiak Mainnet platform-admin wallet before creating the PlatformConfig.",
        );
      }

      const raydium =
        targetIsMainnet
          ? await Raydium.load({
              connection:
                activeSetupConnection,
              owner:
                publicKey,
              signAllTransactions:
                async (
                  transactions,
                ) => {
                  if (
                    transactions.length ===
                    1
                  ) {
                    return [
                      await signTransaction(
                        transactions[0],
                      ),
                    ];
                  }

                  return signAllTransactions(
                    transactions,
                  );
                },
              cluster:
                "mainnet",
              disableFeatureCheck:
                true,
              disableLoadToken:
                true,
              blockhashCommitment:
                "confirmed",
            })
          : await loadKodiakRaydium({
              connection:
                activeSetupConnection,
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
              targetIsMainnet
                ? LAUNCHPAD_PROGRAM
                : KODIAK_LAUNCHPAD_PROGRAM_ID,
            platformAdmin:
              authorities.platformAdmin,
            platformClaimFeeWallet:
              authorities.platformClaimFeeWallet,
            platformLockNftWallet:
              authorities.platformLockNftWallet,
            platformVestingWallet:
              PublicKey.default,
            cpConfigId:
              cpConfig,
            transferFeeExtensionAuth:
              authorities.transferFeeExtensionAuth,
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
          `Simulating the ${targetLabel} transaction before opening your wallet...`,
      });

      const simulation =
        transaction instanceof
        VersionedTransaction
          ? await activeSetupConnection.simulateTransaction(
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
          : await activeSetupConnection.simulateTransaction(
              transaction,
            );

      const simulationLogs =
        simulation.value.logs ??
        [];

      if (
        simulation.value.err
      ) {
        const errorDetails =
          typeof simulation.value.err ===
          "string"
            ? simulation.value.err
            : JSON.stringify(
                simulation.value.err,
              );

        setStatus({
          kind: "error",
          message:
            `${targetLabel} simulation failed: ${errorDetails}`,
          logs:
            simulationLogs,
        });

        return;
      }

      setStatus({
        kind: "working",
        message:
          `Simulation passed. Approve the ${targetLabel} transaction in your wallet...`,
      });

      const result =
        await execute({
          sendAndConfirm:
            true,
        });

      const platformId =
        extInfo.platformId.toBase58();

      window.localStorage.setItem(
        targetIsMainnet
          ? "kodiak-mainnet-platform-id"
          : "kodiak-devnet-platform-id",
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
          `Kodiak ${targetLabel} PlatformConfig created.`,
        platformId,
        signature,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Platform creation failed.";

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
          message.includes(
            "already",
          ) ||
          message.includes(
            "initialized",
          )
            ? `${message} This wallet may already own a platform configuration.`
            : message,
        logs:
          possibleLogs,
      });
    }
  }

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
              Register Kodiak
            </h1>

            <p className="mt-4 max-w-2xl leading-7 text-zinc-400">
              {KODIAK_MAINNET_REQUESTED_BUT_LOCKED
                ? "Mainnet has been requested in production configuration, but Kodiak remains locked to Devnet until the separate Mainnet enable flag is intentionally activated."
                : KODIAK_IS_DEVNET
                  ? "Create Kodiak's one-time Raydium LaunchLab PlatformConfig using test-network SOL only."
                  : "Production PlatformConfig creation is intentionally locked until Kodiak's Mainnet configuration has been fully verified."}
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
              <p className="font-black text-amber-300">
                {KODIAK_MAINNET_REQUESTED_BUT_LOCKED
                  ? "Mainnet requested - locked"
                  : KODIAK_IS_DEVNET
                    ? "Devnet only"
                    : "Mainnet locked"}
              </p>

              <p className="mt-2 text-sm leading-6 text-zinc-400">
                {KODIAK_MAINNET_REQUESTED_BUT_LOCKED
                  ? "The production environment is requesting Mainnet, but Kodiak's second safety gate is still closed. No Mainnet PlatformConfig transaction can be created from this page."
                  : KODIAK_IS_DEVNET
                    ? "This setup page currently creates Kodiak's Raydium LaunchLab PlatformConfig on Devnet only. Your connected wallet will approve a test transaction."
                    : "Kodiak will not create a Mainnet PlatformConfig from this page until the production CPMM configuration and explicit production authority wallets have been verified and intentionally enabled."}
              </p>
            </div>

            {KODIAK_MAINNET_REQUESTED_BUT_LOCKED && (
              <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-5">
                <div className="flex items-center justify-between gap-4">
                  <p className="font-black text-zinc-200">
                    Isolated Mainnet setup
                  </p>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-black ${
                      MAINNET_SETUP_READY
                        ? "bg-emerald-400/10 text-emerald-300"
                        : "bg-amber-300/10 text-amber-300"
                    }`}
                  >
                    {MAINNET_SETUP_READY
                      ? "ARMED"
                      : "LOCKED"}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-zinc-400">
                  This setup uses the dedicated Mainnet RPC only on this page.
                  The rest of Kodiak remains on Devnet.
                </p>
                {!MAINNET_SETUP_ENABLED && (
                  <p className="mt-3 text-sm font-bold text-amber-300">
                    NEXT_PUBLIC_KODIAK_MAINNET_SETUP_ENABLED is not enabled.
                  </p>
                )}
                {MAINNET_SETUP_ENABLED &&
                  !MAINNET_SETUP_RPC_URL && (
                    <p className="mt-3 text-sm font-bold text-red-300">
                      The dedicated Mainnet RPC URL is missing.
                    </p>
                  )}
              </div>
            )}

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
                  {isolatedMainnetSetup
                    ? "Mainnet"
                    : NETWORK_LABEL}{" "}
                  balance:{" "}
                  <span className="font-bold text-zinc-100">
                    {networkBalance ===
                    null
                      ? "Checking..."
                      : `${networkBalance.toFixed(
                          4,
                        )} SOL`}
                  </span>
                </p>

                {KODIAK_IS_DEVNET &&
                  networkBalance !==
                    null &&
                  networkBalance <
                    0.01 && (
                    <p className="mt-2 text-sm font-bold text-amber-300">
                      This wallet may
                      need more Devnet
                      SOL to create the
                      PlatformConfig
                      account.
                    </p>
                  )}
              </div>

              {(KODIAK_IS_MAINNET ||
                KODIAK_MAINNET_REQUESTED_BUT_LOCKED) && (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
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
                        ? "READY"
                        : "INCOMPLETE"}
                    </span>
                  </div>

                  <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-3">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-300">
                      Verified Mainnet CPMM config
                    </p>
                    <p className="mt-2 break-all font-mono text-xs text-zinc-200">
                      {KODIAK_MAINNET_CPMM_CONFIG_ID}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-zinc-500">
                      Raydium Mainnet CPMM index 0 - 0.25% trading fee tier.
                    </p>
                  </div>

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

                  <p className="mt-4 text-xs leading-5 text-zinc-500">
                    Mainnet will use these explicit production authorities
                    instead of copying whichever browser wallet happens to be
                    connected. The connected signer must match the configured
                    platform-admin wallet before creation can occur.
                  </p>
                </div>
              )}

              <label className="block">
                <span className="mb-2 block text-sm font-bold text-zinc-300">
                  {isolatedMainnetSetup
                    ? "Mainnet"
                    : NETWORK_LABEL}{" "}
                  CPMM configuration
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
                    disabled={
                      isolatedMainnetSetup ||
                      !KODIAK_IS_DEVNET
                    }
                    className="w-full rounded-2xl border border-white/10 bg-zinc-950 px-4 py-4 text-sm disabled:cursor-not-allowed disabled:opacity-40"
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
                    disabled={
                      isolatedMainnetSetup ||
                      !KODIAK_IS_DEVNET
                    }
                    placeholder={
                      KODIAK_IS_DEVNET
                        ? "Paste a Devnet CPMM config ID"
                        : "Verified Mainnet CPMM config"
                    }
                    className="w-full rounded-2xl border border-white/10 bg-zinc-950 px-4 py-4 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                  />
                )}

                {cpConfigId &&
                  !cpConfigIsValid && (
                    <p className="mt-2 text-sm font-bold text-red-300">
                      This is not a
                      valid Solana CPMM
                      configuration
                      address.
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
                  disabled={
                    !KODIAK_IS_DEVNET &&
                    !isolatedMainnetSetup
                  }
                  className="mt-1 h-5 w-5 accent-emerald-400 disabled:opacity-40"
                />

                <span className="text-sm leading-6 text-zinc-400">
                  {isolatedMainnetSetup
                    ? "I understand this creates Kodiak's one-time Mainnet PlatformConfig using real SOL, while the rest of Kodiak remains on Devnet."
                    : KODIAK_IS_DEVNET
                      ? "I understand this creates a one-time on-chain configuration tied to my connected wallet and uses Devnet SOL."
                      : "Mainnet PlatformConfig creation is locked until Kodiak's production configuration is intentionally enabled."}
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
                    !canCreate
                  }
                  onClick={() =>
                    void createPlatform()
                  }
                  className="w-full rounded-2xl bg-gradient-to-r from-emerald-400 to-amber-300 px-6 py-4 text-lg font-black text-black disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  {status.kind ===
                  "working"
                    ? "Waiting for transaction..."
                    : isolatedMainnetSetup
                      ? "Create Kodiak Mainnet Platform"
                      : KODIAK_IS_DEVNET
                        ? "Create Kodiak Devnet Platform"
                        : "Mainnet Setup Locked"}
                </button>
              )}
            </div>
          </section>

          <aside className="space-y-5">
            <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-black">
                On-chain settings
              </h2>

              <div className="mt-5 space-y-4 text-sm">
                {[
                  [
                    "Kodiak platform fee",
                    "0.50%",
                  ],
                  [
                    "Creator curve fee",
                    "0.45%",
                  ],
                  [
                    "Migrated LP burned",
                    "90%",
                  ],
                  [
                    "Creator Fee Key share",
                    "10%",
                  ],
                  [
                    "Platform LP share",
                    "0%",
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
                      Solana simulation
                      logs
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
                    PlatformConfig
                    address
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
