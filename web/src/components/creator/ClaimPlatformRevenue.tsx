"use client";

import {
  getPdaPlatformVault,
  TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import { NATIVE_MINT } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";

import {
  DEVNET_LAUNCHPAD_PROGRAM_ID,
  loadDevnetRaydium,
} from "@/lib/raydium/devnet";

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

type FundTransferRecordResponse = RevenueSummaryResponse & {
  recorded?: boolean;
  transferSignature?: string;
  transferredLamports?: number;
  transferredSol?: number;
  error?: string;
};

function signatureFrom(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 20) return value;
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;

  for (const key of ["signature", "txId", "txid", "id"]) {
    const candidate = record[key];

    if (typeof candidate === "string" && candidate.length > 20) {
      return candidate;
    }
  }

  if (Array.isArray(record.txIds)) {
    const first = record.txIds.find(
      (item) => typeof item === "string" && item.length > 20,
    );

    if (typeof first === "string") return first;
  }

  return undefined;
}

const CREATOR_SUCCESS_FUND_WALLET = new PublicKey(
  "EJeXJ7Bf6nyJ2p4i7kR8Wyfdmi3JgpdU3iDRMCzZheWG",
);

export function ClaimPlatformRevenue() {
  const { connection } = useConnection();
  const {
    connected,
    publicKey,
    signAllTransactions,
    signTransaction,
  } = useWallet();

  const [status, setStatus] = useState<Status>({
    kind: "idle",
    message:
      "Claims Kodiak's accumulated Raydium LaunchLab platform fees on Devnet.",
  });

  const [claimableSol, setClaimableSol] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [revenueSummary, setRevenueSummary] =
    useState<RevenueSummaryResponse | null>(null);
  const [revenueLoading, setRevenueLoading] = useState(true);

  const busy = status.kind === "working";

  const refreshClaimableBalance = useCallback(async () => {
    setBalanceLoading(true);

    try {
      const response = await fetch("/api/config", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(
          `Unable to load Kodiak PlatformConfig (${response.status}).`,
        );
      }

      const config = (await response.json()) as KodiakConfigResponse;

      if (!config.platformId) {
        throw new Error(
          "Kodiak PlatformConfig ID is not available.",
        );
      }

      const platformId = new PublicKey(config.platformId);

      const platformVault =
        getPdaPlatformVault(
          DEVNET_LAUNCHPAD_PROGRAM_ID,
          platformId,
          NATIVE_MINT,
        ).publicKey;

      const balance =
        await connection.getTokenAccountBalance(platformVault);

      setClaimableSol(
        Number(balance.value.uiAmountString ?? "0"),
      );
    } catch (error) {
      console.error(
        "Unable to read Kodiak platform-fee vault:",
        error,
      );
      setClaimableSol(null);
    } finally {
      setBalanceLoading(false);
    }
  }, [connection]);

  const refreshRevenueSummary = useCallback(async () => {
    setRevenueLoading(true);

    try {
      const response = await fetch("/api/admin/revenue", {
        cache: "no-store",
      });

      const payload =
        (await response.json()) as RevenueSummaryResponse;

      if (!response.ok) {
        throw new Error(
          payload.error ??
            `Unable to load revenue accounting (${response.status}).`,
        );
      }

      setRevenueSummary(payload);
    } catch (error) {
      console.error(
        "Unable to load Kodiak revenue accounting:",
        error,
      );
      setRevenueSummary(null);
    } finally {
      setRevenueLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshClaimableBalance();
      void refreshRevenueSummary();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [refreshClaimableBalance, refreshRevenueSummary]);

  async function recordVerifiedClaim(
    signature: string,
  ): Promise<RevenueRecordResponse> {
    const response = await fetch("/api/admin/revenue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ signature }),
    });

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
    const response = await fetch("/api/admin/revenue", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ signature }),
    });

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

    if (!signTransaction) {
      throw new Error(
        "This wallet does not expose signTransaction().",
      );
    }

    if (!Number.isSafeInteger(lamports) || lamports <= 0) {
      throw new Error(
        "The pending Creator Success Fund amount is invalid.",
      );
    }

    const balance =
      await connection.getBalance(publicKey, "confirmed");

    const latestBlockhash =
      await connection.getLatestBlockhash("confirmed");

    const transaction =
      new Transaction({
        feePayer: publicKey,
        recentBlockhash: latestBlockhash.blockhash,
      }).add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: CREATOR_SUCCESS_FUND_WALLET,
          lamports,
        }),
      );

    const fee = await transaction.getEstimatedFee(connection);
    const estimatedFee =
      typeof fee === "number" ? fee : 5_000;

    if (balance < lamports + estimatedFee) {
      throw new Error(
        `Kodiak's Devnet RPC sees only ${(balance / 1_000_000_000).toFixed(9)} SOL in the connected wallet, but the transfer plus fee needs about ${((lamports + estimatedFee) / 1_000_000_000).toFixed(9)} SOL.`,
      );
    }

    setStatus({
      kind: "working",
      message:
        "Approve the Success Fund signature request. Kodiak will submit the signed transaction directly to Devnet.",
    });

    const signedTransaction =
      await signTransaction(transaction);

    const fundSignature =
      await connection.sendRawTransaction(
        signedTransaction.serialize(),
        {
          skipPreflight: false,
          maxRetries: 5,
        },
      );

    const confirmation =
      await connection.confirmTransaction(
        {
          signature: fundSignature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight:
            latestBlockhash.lastValidBlockHeight,
        },
        "confirmed",
      );

    if (confirmation.value.err) {
      throw new Error(
        "The signed Creator Success Fund transaction reached Devnet but failed confirmation.",
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

    await recordVerifiedFundTransfer(fundSignature);

    return fundSignature;
  }

  async function retryPendingSuccessFund() {
    const pendingLamports =
      revenueSummary?.pendingCreatorSuccessFundLamports ?? 0;

    if (!connected || !publicKey || !signTransaction) {
      setStatus({
        kind: "error",
        message:
          "Connect the authorized Kodiak platform wallet first.",
      });
      return;
    }

    if (pendingLamports <= 0) {
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
          "The pending Creator Success Fund balance was signed, submitted directly to Devnet, confirmed, and verified by Kodiak.",
        fundSignature,
      });

      await refreshRevenueSummary();
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The pending Creator Success Fund transfer failed.",
      });
    }
  }

  async function claimRevenue() {
    if (
      !connected ||
      !publicKey ||
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
      setStatus({
        kind: "working",
        message:
          "Loading Kodiak's Raydium PlatformConfig...",
      });

      const response = await fetch("/api/config", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(
          `Unable to load Kodiak PlatformConfig (${response.status}).`,
        );
      }

      const config =
        (await response.json()) as KodiakConfigResponse;

      if (!config.platformId) {
        throw new Error(
          "Kodiak PlatformConfig ID is not available.",
        );
      }

      const platformId =
        new PublicKey(config.platformId);

      const raydium =
        await loadDevnetRaydium({
          connection,
          owner: publicKey,
          signAllTransactions,
        });

      setStatus({
        kind: "working",
        message:
          "Building Kodiak's platform-vault claim...",
      });

      const { execute } =
        await raydium.launchpad.claimVaultPlatformFee({
          programId:
            DEVNET_LAUNCHPAD_PROGRAM_ID,
          platformId,
          mintB: NATIVE_MINT,
          claimFeeWallet: publicKey,
          txVersion: TxVersion.V0,
          feePayer: publicKey,
        });

      setStatus({
        kind: "working",
        message:
          "Approve the Kodiak platform-revenue claim in Phantom...",
      });

      const result = await execute({
        sendAndConfirm: true,
      });

      const signature = signatureFrom(result);

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
        await recordVerifiedClaim(signature);

      const claimed =
        typeof accounting.claimedSol === "number"
          ? accounting.claimedSol
          : null;

      const total =
        typeof accounting.totalClaimedSol === "number"
          ? accounting.totalClaimedSol
          : null;

      const verifiedText =
        claimed === null
          ? ""
          : ` ${claimed.toFixed(9)} SOL was verified and recorded.`;

      const lifetimeText =
        total === null
          ? ""
          : ` Lifetime claimed revenue is now ${total.toFixed(9)} SOL.`;

      const pendingLamports =
        typeof accounting.pendingCreatorSuccessFundLamports === "number"
          ? accounting.pendingCreatorSuccessFundLamports
          : 0;

      let fundSignature: string | undefined;

      if (pendingLamports > 0 && signTransaction) {
        try {
          fundSignature =
            await sendAndRecordPendingFund(
              pendingLamports,
            );
        } catch (fundError) {
          await Promise.all([
            refreshClaimableBalance(),
            refreshRevenueSummary(),
          ]);

          setStatus({
            kind: "error",
            message:
              `The platform claim succeeded and revenue was recorded, but the Creator Success Fund transfer did not complete. The allocation remains pending and can be retried without another platform claim. ${
                fundError instanceof Error
                  ? fundError.message
                  : ""
              }`.trim(),
            signature,
          });

          return;
        }
      }

      setStatus({
        kind: "success",
        message:
          `Raydium confirmed Kodiak's platform-vault revenue claim on Devnet.${verifiedText}${lifetimeText}${
            fundSignature
              ? " The pending Creator Success Fund balance was signed and submitted directly to Devnet."
              : ""
          }`,
        signature,
        fundSignature,
      });

      await Promise.all([
        refreshClaimableBalance(),
        refreshRevenueSummary(),
      ]);
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Kodiak platform-revenue claim failed.",
      });
    }
  }

  const pendingSol =
    revenueSummary?.pendingCreatorSuccessFundSol ?? 0;

  return (
    <section className="mt-6 rounded-[2rem] border border-amber-300/20 bg-amber-300/[0.04] p-5 sm:p-6">
      <div className="max-w-2xl">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">
          Kodiak platform revenue
        </p>

        <h2 className="mt-2 text-2xl font-black">
          Claim Platform Fees
        </h2>
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">
              Verified revenue accounting
            </p>
          </div>

          <button
            type="button"
            onClick={() => void refreshRevenueSummary()}
            disabled={revenueLoading}
            className="rounded-xl border border-white/10 px-3 py-2 text-xs font-black text-zinc-400 disabled:opacity-40"
          >
            {revenueLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-zinc-500">
              Lifetime platform revenue
            </p>
            <p className="mt-2 text-xl font-black text-zinc-100">
              {revenueLoading
                ? "Loading..."
                : revenueSummary?.claimedSol === undefined
                  ? "Unavailable"
                  : `${revenueSummary.claimedSol.toFixed(9)} SOL`}
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-emerald-300">
              Creator Success Fund - 5%
            </p>
            <p className="mt-2 text-xl font-black text-emerald-200">
              {revenueLoading
                ? "Loading..."
                : revenueSummary?.creatorSuccessFundSol === undefined
                  ? "Unavailable"
                  : `${revenueSummary.creatorSuccessFundSol.toFixed(9)} SOL`}
            </p>
            <p className="mt-3 text-xs text-zinc-500">
              Transferred:{" "}
              {revenueLoading
                ? "..."
                : `${(
                    revenueSummary?.creatorSuccessFundTransferredSol ?? 0
                  ).toFixed(9)} SOL`}
            </p>
            <p className="text-xs text-zinc-500">
              Pending:{" "}
              {revenueLoading
                ? "..."
                : `${pendingSol.toFixed(9)} SOL`}
            </p>
          </div>

          <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.04] p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-amber-300">
              Kodiak operating revenue - 95%
            </p>
            <p className="mt-2 text-xl font-black text-amber-200">
              {revenueLoading
                ? "Loading..."
                : revenueSummary?.kodiakOperatingSol === undefined
                  ? "Unavailable"
                  : `${revenueSummary.kodiakOperatingSol.toFixed(9)} SOL`}
            </p>
          </div>
        </div>

        {pendingSol > 0 ? (
          <button
            type="button"
            onClick={() => void retryPendingSuccessFund()}
            disabled={
              !connected ||
              !signTransaction ||
              busy ||
              revenueLoading
            }
            className="mt-3 w-full rounded-xl border border-emerald-400/30 bg-emerald-400/[0.08] px-4 py-3 text-sm font-black text-emerald-200 disabled:opacity-40"
          >
            {busy
              ? "Working..."
              : `Send Pending Success Fund (${pendingSol.toFixed(9)} SOL)`}
          </button>
        ) : null}
      </div>

      <div className="mt-5 rounded-2xl border border-amber-300/20 bg-black/20 p-4">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">
          Raydium claimable now
        </p>

        <p className="mt-2 text-2xl font-black text-amber-300">
          {balanceLoading
            ? "Loading..."
            : claimableSol === null
              ? "Unavailable"
              : `${claimableSol.toFixed(9)} SOL`}
        </p>

        <button
          type="button"
          onClick={() => void refreshClaimableBalance()}
          disabled={balanceLoading}
          className="mt-3 rounded-xl border border-white/10 px-3 py-2 text-xs font-black text-zinc-400 disabled:opacity-40"
        >
          {balanceLoading ? "Refreshing..." : "Refresh balance"}
        </button>
      </div>

      <button
        type="button"
        disabled={!connected || busy}
        onClick={() => void claimRevenue()}
        className="mt-5 w-full rounded-xl bg-amber-300 px-5 py-3 text-sm font-black text-black disabled:opacity-40"
      >
        {busy
          ? "Claiming..."
          : "Claim Kodiak Revenue on Devnet"}
      </button>

      <div
        className={`mt-5 rounded-2xl border p-4 text-sm ${
          status.kind === "error"
            ? "border-rose-400/20 bg-rose-400/[0.05] text-rose-200"
            : status.kind === "success"
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
