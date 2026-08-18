"use client";

import {
  getPdaPlatformVault,
  TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";
import {
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  KODIAK_LAUNCHPAD_PROGRAM_ID,
  loadKodiakRaydium,
} from "@/lib/raydium/devnet";
import {
  KODIAK_IS_DEVNET,
  KODIAK_IS_MAINNET,
  KODIAK_NETWORK,
  kodiakNetworkLabel,
} from "@/lib/solana/network";

type Status =
  | { kind: "idle"; message: string }
  | { kind: "working"; message: string }
  | {
      kind: "success";
      message: string;
      signature?: string;
      fundSignature?: string;
    }
  | {
      kind: "error";
      message: string;
      signature?: string;
      fundSignature?: string;
    };

type KodiakConfigResponse = {
  platformId?: string;
  network?: string;
  error?: string;
};

type RevenueRecordResponse = {
  recorded?: boolean;
  claimedSol?: number;
  totalClaimedSol?: number;
  pendingCreatorSuccessFundLamports?: number;
  pendingCreatorSuccessFundSol?: number;
  claimCount?: number;
  updatedAt?: number;
  error?: string;
};

type RevenueSummaryResponse = {
  network?: string;
  claimedSol?: number;
  creatorSuccessFundPercent?: number;
  creatorSuccessFundSol?: number;
  creatorSuccessFundTransferredLamports?: number;
  creatorSuccessFundTransferredSol?: number;
  pendingCreatorSuccessFundLamports?: number;
  pendingCreatorSuccessFundSol?: number;
  creatorSuccessFundWallet?: string;
  lastCreatorSuccessFundTransferSignature?: string;
  kodiakOperatingPercent?: number;
  kodiakOperatingSol?: number;
  claimCount?: number;
  lastClaimSignature?: string;
  updatedAt?: number;
  error?: string;
};

type FundTransferRecordResponse =
  RevenueSummaryResponse & {
    recorded?: boolean;
    transferSignature?: string;
    transferredLamports?: number;
    transferredSol?: number;
    error?: string;
  };

const NETWORK_LABEL = kodiakNetworkLabel();

const MAINNET_PLATFORM_CLAIM_FEE_WALLET =
  process.env.NEXT_PUBLIC_KODIAK_PLATFORM_CLAIM_FEE_WALLET?.trim() ?? "";

function validConfiguredPublicKey(
  value: string,
) {
  if (!value) {
    return false;
  }

  try {
    return (
      new PublicKey(
        value,
      ).toBase58() ===
      value
    );
  } catch {
    return false;
  }
}

function assertMainnetClaimWallet(
  publicKey: PublicKey,
) {
  if (!KODIAK_IS_MAINNET) {
    return;
  }

  if (
    !validConfiguredPublicKey(
      MAINNET_PLATFORM_CLAIM_FEE_WALLET,
    )
  ) {
    throw new Error(
      "Kodiak Mainnet platform fee-claim wallet is not configured.",
    );
  }

  if (
    publicKey.toBase58() !==
    MAINNET_PLATFORM_CLAIM_FEE_WALLET
  ) {
    throw new Error(
      "Connect Kodiak's configured Mainnet platform fee-claim wallet before claiming or transferring platform revenue.",
    );
  }
}

function signatureFrom(
  value: unknown,
): string | undefined {
  if (
    typeof value === "string" &&
    value.length > 20
  ) {
    return value;
  }

  if (
    !value ||
    typeof value !== "object"
  ) {
    return undefined;
  }

  const record =
    value as Record<
      string,
      unknown
    >;

  for (
    const key of [
      "signature",
      "txId",
      "txid",
      "id",
    ]
  ) {
    const candidate =
      record[key];

    if (
      typeof candidate === "string" &&
      candidate.length > 20
    ) {
      return candidate;
    }
  }

  if (
    Array.isArray(
      record.txIds,
    )
  ) {
    const first =
      record.txIds.find(
        (item) =>
          typeof item ===
            "string" &&
          item.length > 20,
      );

    if (
      typeof first ===
      "string"
    ) {
      return first;
    }
  }

  return undefined;
}

const CREATOR_SUCCESS_FUND_WALLET =
  new PublicKey(
    "EJeXJ7Bf6nyJ2p4i7kR8Wyfdmi3JgpdU3iDRMCzZheWG",
  );

export function ClaimPlatformRevenue() {
  const { connection } =
    useConnection();

  const {
    connected,
    publicKey,
    signAllTransactions,
    signTransaction,
  } = useWallet();

  const [
    status,
    setStatus,
  ] = useState<Status>({
    kind: "idle",
    message:
      `Claims Kodiak's accumulated Raydium LaunchLab platform fees on ${NETWORK_LABEL}.`,
  });

  const [
    claimableSol,
    setClaimableSol,
  ] = useState<
    number | null
  >(null);

  const [
    balanceLoading,
    setBalanceLoading,
  ] = useState(true);

  const [
    revenueSummary,
    setRevenueSummary,
  ] =
    useState<
      RevenueSummaryResponse | null
    >(null);

  const [
    revenueLoading,
    setRevenueLoading,
  ] = useState(true);

  const busy =
    status.kind ===
    "working";

  const refreshClaimableBalance =
    useCallback(
      async () => {
        setBalanceLoading(
          true,
        );

        try {
          const response =
            await fetch(
              "/api/config",
              {
                cache:
                  "no-store",
              },
            );

          const config =
            (await response.json()) as KodiakConfigResponse;

          if (
            !response.ok
          ) {
            throw new Error(
              config.error ??
                `Unable to load Kodiak PlatformConfig (${response.status}).`,
            );
          }

          if (
            config.network &&
            config.network !==
              KODIAK_NETWORK
          ) {
            throw new Error(
              `Kodiak config returned ${config.network}, but this client is running on ${KODIAK_NETWORK}.`,
            );
          }

          if (
            !config.platformId
          ) {
            throw new Error(
              "Kodiak PlatformConfig ID is not available.",
            );
          }

          const platformId =
            new PublicKey(
              config.platformId,
            );

          const platformVault =
            getPdaPlatformVault(
              KODIAK_LAUNCHPAD_PROGRAM_ID,
              platformId,
              NATIVE_MINT,
            ).publicKey;

          const balance =
            await connection.getTokenAccountBalance(
              platformVault,
            );

          setClaimableSol(
            Number(
              balance.value
                .uiAmountString ??
                "0",
            ),
          );
        } catch (error) {
          console.error(
            "Unable to read Kodiak platform-fee vault:",
            error,
          );

          setClaimableSol(
            null,
          );
        } finally {
          setBalanceLoading(
            false,
          );
        }
      },
      [connection],
    );

  const refreshRevenueSummary =
    useCallback(
      async () => {
        setRevenueLoading(
          true,
        );

        try {
          const response =
            await fetch(
              "/api/admin/revenue",
              {
                cache:
                  "no-store",
              },
            );

          const payload =
            (await response.json()) as RevenueSummaryResponse;

          if (
            !response.ok
          ) {
            throw new Error(
              payload.error ??
                `Unable to load revenue accounting (${response.status}).`,
            );
          }

          setRevenueSummary(
            payload,
          );
        } catch (error) {
          console.error(
            "Unable to load Kodiak revenue accounting:",
            error,
          );

          setRevenueSummary(
            null,
          );
        } finally {
          setRevenueLoading(
            false,
          );
        }
      },
      [],
    );

  useEffect(() => {
    const timer =
      window.setTimeout(
        () => {
          void refreshClaimableBalance();
          void refreshRevenueSummary();
        },
        0,
      );

    return () =>
      window.clearTimeout(
        timer,
      );
  }, [
    refreshClaimableBalance,
    refreshRevenueSummary,
  ]);

  async function recordVerifiedClaim(
    signature: string,
  ): Promise<RevenueRecordResponse> {
    const response =
      await fetch(
        "/api/admin/revenue",
        {
          method:
            "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body:
            JSON.stringify({
              signature,
            }),
        },
      );

    const payload =
      (await response.json()) as RevenueRecordResponse;

    if (!response.ok) {
      throw new Error(
        payload.error ??
          `Revenue accounting failed (${response.status}).`,
      );
    }

    return payload;
  }

  async function recordVerifiedFundTransfer(
    signature: string,
  ): Promise<FundTransferRecordResponse> {
    const response =
      await fetch(
        "/api/admin/revenue",
        {
          method:
            "PATCH",
          headers: {
            "Content-Type":
              "application/json",
          },
          body:
            JSON.stringify({
              signature,
            }),
        },
      );

    const payload =
      (await response.json()) as FundTransferRecordResponse;

    if (!response.ok) {
      throw new Error(
        payload.error ??
          `Success Fund accounting failed (${response.status}).`,
      );
    }

    return payload;
  }

  async function sendCreatorSuccessFundTransfer(
    lamports: number,
  ): Promise<string> {
    if (!publicKey) {
      throw new Error(
        "The authorized Kodiak wallet is not connected.",
      );
    }

    if (KODIAK_IS_DEVNET) {
      throw new Error(
        "Creator Success Fund treasury transfers are intentionally disabled on Devnet.",
      );
    }

    assertMainnetClaimWallet(
      publicKey,
    );

    if (!signTransaction) {
      throw new Error(
        "This wallet does not expose signTransaction().",
      );
    }

    if (
      !Number.isSafeInteger(
        lamports,
      ) ||
      lamports <= 0
    ) {
      throw new Error(
        "The pending Creator Success Fund amount is invalid.",
      );
    }

    const balance =
      await connection.getBalance(
        publicKey,
        "confirmed",
      );

    const latestBlockhash =
      await connection.getLatestBlockhash(
        "finalized",
      );

    const transaction =
      new Transaction({
        feePayer:
          publicKey,
        recentBlockhash:
          latestBlockhash.blockhash,
      }).add(
        SystemProgram.transfer({
          fromPubkey:
            publicKey,
          toPubkey:
            CREATOR_SUCCESS_FUND_WALLET,
          lamports,
        }),
      );

    const fee =
      await transaction.getEstimatedFee(
        connection,
      );

    const estimatedFee =
      typeof fee ===
      "number"
        ? fee
        : 5_000;

    if (
      balance <
      lamports +
        estimatedFee
    ) {
      throw new Error(
        `Kodiak's ${NETWORK_LABEL} RPC sees only ${(balance / 1_000_000_000).toFixed(9)} SOL in the connected wallet, but the transfer plus fee needs about ${((lamports + estimatedFee) / 1_000_000_000).toFixed(9)} SOL.`,
      );
    }

    setStatus({
      kind: "working",
      message:
        `Approve the Success Fund signature request. Kodiak will submit the signed transaction directly to ${NETWORK_LABEL}.`,
    });

    const signedTransaction =
      await signTransaction(
        transaction,
      );

    const currentBlockHeight =
      await connection.getBlockHeight(
        "confirmed",
      );

    if (
      currentBlockHeight >
      latestBlockhash.lastValidBlockHeight
    ) {
      throw new Error(
        "Wallet approval took too long and the Solana blockhash expired. No Creator Success Fund transfer was sent; try again and approve promptly.",
      );
    }

    const fundSignature =
      await connection.sendRawTransaction(
        signedTransaction.serialize(),
        {
          skipPreflight:
            false,
          maxRetries:
            5,
        },
      );

    const confirmation =
      await connection.confirmTransaction(
        {
          signature:
            fundSignature,
          blockhash:
            latestBlockhash.blockhash,
          lastValidBlockHeight:
            latestBlockhash.lastValidBlockHeight,
        },
        "confirmed",
      );

    if (
      confirmation.value
        .err
    ) {
      throw new Error(
        `The signed Creator Success Fund transaction reached ${NETWORK_LABEL} but failed confirmation.`,
      );
    }

    return fundSignature;
  }

  async function sendAndRecordPendingFund(
    pendingLamports: number,
  ): Promise<string> {
    const fundSignature =
      await sendCreatorSuccessFundTransfer(
        pendingLamports,
      );

    await recordVerifiedFundTransfer(
      fundSignature,
    );

    return fundSignature;
  }

  async function retryPendingSuccessFund() {
    const pendingLamports =
      revenueSummary
        ?.pendingCreatorSuccessFundLamports ??
      0;

    if (
      !connected ||
      !publicKey ||
      !signTransaction
    ) {
      setStatus({
        kind: "error",
        message:
          "Connect the authorized Kodiak platform wallet first.",
      });
      return;
    }

    if (KODIAK_IS_DEVNET) {
      setStatus({
        kind: "error",
        message:
          "Creator Success Fund treasury transfers are intentionally disabled on Devnet.",
      });
      return;
    }

    try {
      assertMainnetClaimWallet(
        publicKey,
      );
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The connected Mainnet wallet is not authorized for platform revenue.",
      });
      return;
    }

    if (
      pendingLamports <=
      0
    ) {
      setStatus({
        kind: "idle",
        message:
          "There is no pending Creator Success Fund balance to transfer.",
      });
      return;
    }

    try {
      const fundSignature =
        await sendAndRecordPendingFund(
          pendingLamports,
        );

      setStatus({
        kind: "success",
        message:
          `The pending Creator Success Fund balance was signed, submitted directly to ${NETWORK_LABEL}, confirmed, and verified by Kodiak.`,
        fundSignature,
      });

      await refreshRevenueSummary();
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof
          Error
            ? error.message
            : "The pending Creator Success Fund transfer failed.",
      });
    }
  }

  async function claimRevenue() {
    if (
      !connected ||
      !publicKey ||
      !signTransaction ||
      !signAllTransactions
    ) {
      setStatus({
        kind: "error",
        message:
          "Connect the authorized Kodiak platform wallet first.",
      });
      return;
    }

    try {
      assertMainnetClaimWallet(
        publicKey,
      );

      setStatus({
        kind: "working",
        message:
          "Loading Kodiak's Raydium PlatformConfig...",
      });

      const response =
        await fetch(
          "/api/config",
          {
            cache:
              "no-store",
          },
        );

      const config =
        (await response.json()) as KodiakConfigResponse;

      if (!response.ok) {
        throw new Error(
          config.error ??
            `Unable to load Kodiak PlatformConfig (${response.status}).`,
        );
      }

      if (
        config.network &&
        config.network !==
          KODIAK_NETWORK
      ) {
        throw new Error(
          `Kodiak config returned ${config.network}, but this client is running on ${KODIAK_NETWORK}.`,
        );
      }

      if (
        !config.platformId
      ) {
        throw new Error(
          "Kodiak PlatformConfig ID is not available.",
        );
      }

      const platformId =
        new PublicKey(
          config.platformId,
        );

      const raydium =
        await loadKodiakRaydium({
          connection,
          owner:
            publicKey,
          signTransaction,
          signAllTransactions,
        });

      setStatus({
        kind: "working",
        message:
          "Building Kodiak's platform-vault claim...",
      });

      const {
        execute,
      } =
        await raydium.launchpad.claimVaultPlatformFee(
          {
            programId:
              KODIAK_LAUNCHPAD_PROGRAM_ID,
            platformId,
            mintB:
              NATIVE_MINT,
            claimFeeWallet:
              KODIAK_IS_MAINNET
                ? new PublicKey(
                    MAINNET_PLATFORM_CLAIM_FEE_WALLET,
                  )
                : publicKey,
            txVersion:
              TxVersion.V0,
            feePayer:
              publicKey,
          },
        );

      setStatus({
        kind: "working",
        message:
          `Approve the Kodiak platform-revenue claim on ${NETWORK_LABEL} in your wallet...`,
      });

      const result =
        await execute({
          sendAndConfirm:
            true,
        });

      const signature =
        signatureFrom(
          result,
        );

      if (!signature) {
        throw new Error(
          "Raydium confirmed the claim, but Kodiak could not read the transaction signature.",
        );
      }

      setStatus({
        kind: "working",
        message:
          "Claim confirmed. Verifying and recording revenue...",
      });

      const accounting =
        await recordVerifiedClaim(
          signature,
        );

      const claimed =
        typeof accounting.claimedSol ===
        "number"
          ? accounting.claimedSol
          : null;

      const total =
        typeof accounting.totalClaimedSol ===
        "number"
          ? accounting.totalClaimedSol
          : null;

      const verifiedText =
        claimed ===
        null
          ? ""
          : ` ${claimed.toFixed(9)} SOL was verified and recorded.`;

      const lifetimeText =
        total ===
        null
          ? ""
          : ` Lifetime claimed revenue is now ${total.toFixed(9)} SOL.`;

      setStatus({
        kind: "success",
        message:
          KODIAK_IS_DEVNET
            ? `Raydium confirmed Kodiak's platform-vault revenue claim on Devnet.${verifiedText}${lifetimeText} The 5% Creator Success Fund allocation was recorded as pending. Devnet treasury transfers are intentionally disabled and will activate on Mainnet.`
            : `Raydium confirmed Kodiak's platform-vault revenue claim on ${NETWORK_LABEL}.${verifiedText}${lifetimeText}`,
        signature,
      });

      await Promise.all([
        refreshClaimableBalance(),
        refreshRevenueSummary(),
      ]);
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof
          Error
            ? error.message
            : "Kodiak platform-revenue claim failed.",
      });
    }
  }

  const pendingSol =
    revenueSummary
      ?.pendingCreatorSuccessFundSol ??
    0;

  return (
    <section className="mt-6 rounded-[2rem] border border-amber-300/20 bg-amber-300/[0.04] p-5 sm:p-6">
      <div className="max-w-2xl">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">
          Kodiak platform
          revenue
        </p>

        <h2 className="mt-2 text-2xl font-black">
          Claim Platform
          Fees
        </h2>
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">
              Verified revenue
              accounting
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              void refreshRevenueSummary()
            }
            disabled={
              revenueLoading
            }
            className="rounded-xl border border-white/10 px-3 py-2 text-xs font-black text-zinc-400 disabled:opacity-40"
          >
            {revenueLoading
              ? "Refreshing..."
              : "Refresh"}
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-zinc-500">
              Lifetime
              platform
              revenue
            </p>

            <p className="mt-2 text-xl font-black text-zinc-100">
              {revenueLoading
                ? "Loading..."
                : revenueSummary
                      ?.claimedSol ===
                    undefined
                  ? "Unavailable"
                  : `${revenueSummary.claimedSol.toFixed(9)} SOL`}
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-emerald-300">
              Creator Success
              Fund - 5%
            </p>

            <p className="mt-2 text-xl font-black text-emerald-200">
              {revenueLoading
                ? "Loading..."
                : revenueSummary
                      ?.creatorSuccessFundSol ===
                    undefined
                  ? "Unavailable"
                  : `${revenueSummary.creatorSuccessFundSol.toFixed(9)} SOL`}
            </p>

            <p className="mt-3 text-xs text-zinc-500">
              Transferred:{" "}
              {revenueLoading
                ? "..."
                : `${(
                    revenueSummary
                      ?.creatorSuccessFundTransferredSol ??
                    0
                  ).toFixed(
                    9,
                  )} SOL`}
            </p>

            <p className="text-xs text-zinc-500">
              Pending allocation:{" "}
              {revenueLoading
                ? "..."
                : `${pendingSol.toFixed(
                    9,
                  )} SOL`}
            </p>
          </div>

          <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.04] p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-amber-300">
              Kodiak operating
              revenue - 95%
            </p>

            <p className="mt-2 text-xl font-black text-amber-200">
              {revenueLoading
                ? "Loading..."
                : revenueSummary
                      ?.kodiakOperatingSol ===
                    undefined
                  ? "Unavailable"
                  : `${revenueSummary.kodiakOperatingSol.toFixed(9)} SOL`}
            </p>
          </div>
        </div>

        {KODIAK_IS_DEVNET ? (
          <div className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] px-4 py-3">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-300">
              Devnet
              accounting mode
            </p>

            <p className="mt-1 text-xs leading-5 text-zinc-400">
              Kodiak is tracking
              the 5% Creator
              Success Fund
              allocation as
              pending during
              Devnet testing.
              Actual treasury
              transfers are
              disabled on Devnet
              and will activate
              on Mainnet.
            </p>

            {pendingSol > 0 ? (
              <p className="mt-2 text-xs font-black text-amber-300">
                Pending for
                Mainnet treasury
                flow:{" "}
                {pendingSol.toFixed(
                  9,
                )}{" "}
                SOL
              </p>
            ) : null}
          </div>
        ) : null}

        {KODIAK_IS_MAINNET ? (
          <div className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] px-4 py-3">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-300">
              Mainnet Creator Success Fund
            </p>

            <p className="mt-1 text-xs leading-5 text-zinc-400">
              Kodiak records 5% of verified platform revenue as a separate pending allocation. The transfer below requires its own wallet approval and sends only that pending amount to the dedicated Creator Success Fund wallet.
            </p>

            <p className="mt-2 break-all text-[11px] text-zinc-500">
              Destination: {CREATOR_SUCCESS_FUND_WALLET.toBase58()}
            </p>

            <button
              type="button"
              disabled={
                !connected ||
                busy ||
                pendingSol <= 0
              }
              onClick={() =>
                void retryPendingSuccessFund()
              }
              className="mt-3 w-full rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pendingSol > 0
                ? `Transfer Pending 5% (${pendingSol.toFixed(9)} SOL)`
                : "No Success Fund Transfer Pending"}
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-5 rounded-2xl border border-amber-300/20 bg-black/20 p-4">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">
          Raydium claimable
          now
        </p>

        <p className="mt-2 text-2xl font-black text-amber-300">
          {balanceLoading
            ? "Loading..."
            : claimableSol ===
                null
              ? "Unavailable"
              : `${claimableSol.toFixed(9)} SOL`}
        </p>

        <button
          type="button"
          onClick={() =>
            void refreshClaimableBalance()
          }
          disabled={
            balanceLoading
          }
          className="mt-3 rounded-xl border border-white/10 px-3 py-2 text-xs font-black text-zinc-400 disabled:opacity-40"
        >
          {balanceLoading
            ? "Refreshing..."
            : "Refresh balance"}
        </button>
      </div>

      <button
        type="button"
        disabled={
          !connected ||
          busy
        }
        onClick={() =>
          void claimRevenue()
        }
        className="mt-5 w-full rounded-xl bg-amber-300 px-5 py-3 text-sm font-black text-black disabled:opacity-40"
      >
        {busy
          ? "Claiming..."
          : `Claim Kodiak Revenue on ${NETWORK_LABEL}`}
      </button>

      <div
        className={`mt-5 rounded-2xl border p-4 text-sm ${
          status.kind ===
          "error"
            ? "border-rose-400/20 bg-rose-400/[0.05] text-rose-200"
            : status.kind ===
                "success"
              ? "border-amber-300/20 bg-amber-300/[0.05] text-amber-200"
              : "border-white/10 bg-black/20 text-zinc-500"
        }`}
      >
        <p className="font-bold">
          {status.message}
        </p>
      </div>
    </section>
  );
}
