"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { kodiakExplorerTransactionUrl } from "@/lib/solana/network";

type RewardStatus = {
  enabled?: boolean;
  vaultConfigured?: boolean;
  vault?: string | null;
  vaultSol?: number;
  generatedSol?: number;
  claimableSol?: number;
  lifetimeClaimedSol?: number;
  tokenBalanceRaw?: string;
  eligible?: boolean;
  holderRewardBps?: number;
  creatorRetainedBps?: number;
  error?: string;
};

type ClaimState =
  | { kind: "idle"; message: string }
  | { kind: "working"; message: string }
  | { kind: "success"; message: string; signature: string }
  | { kind: "error"; message: string };

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return window.btoa(binary);
}

function formatSol(value: number | undefined) {
  return Number(value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

export function ClaimSolRewards({ mint }: { mint: string }) {
  const { connected, publicKey, signMessage } = useWallet();
  const [status, setStatus] = useState<RewardStatus | null>(null);
  const [claim, setClaim] = useState<ClaimState>({
    kind: "idle",
    message: "Eligible $KODIAK holders earn their share of the SOL rewards pool from verified trading activity.",
  });

  const officialMint = process.env.NEXT_PUBLIC_KODIAK_OFFICIAL_DEVNET_MINT?.trim() ?? "";
  const isOfficial = Boolean(officialMint && mint === officialMint);
  const wallet = publicKey?.toBase58() ?? "";
  const busy = claim.kind === "working";

  const refresh = useCallback(async () => {
    if (!isOfficial) return;

    const query = wallet ? `?wallet=${encodeURIComponent(wallet)}` : "";
    const response = await fetch(`/api/token/${encodeURIComponent(mint)}/rewards${query}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as RewardStatus;

    if (!response.ok) throw new Error(payload.error ?? "Unable to load SOL rewards.");
    setStatus(payload);
  }, [isOfficial, mint, wallet]);

  useEffect(() => {
    if (!isOfficial) return;

    void refresh().catch((error) => {
      setClaim({ kind: "error", message: error instanceof Error ? error.message : "Unable to load SOL rewards." });
    });

    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 15_000);

    return () => window.clearInterval(timer);
  }, [isOfficial, refresh]);

  const canClaim = useMemo(
    () =>
      Boolean(
        connected &&
          wallet &&
          signMessage &&
          status?.vaultConfigured &&
          Number(status?.claimableSol ?? 0) > 0 &&
          !busy,
      ),
    [busy, connected, signMessage, status, wallet],
  );

  if (!isOfficial) return null;

  const claimSol = async () => {
    if (!wallet || !publicKey) {
      setClaim({ kind: "error", message: "Connect the wallet that holds $KODIAK first." });
      return;
    }

    if (!signMessage) {
      setClaim({ kind: "error", message: "This wallet does not support message signing, which is required to protect SOL claims." });
      return;
    }

    try {
      setClaim({ kind: "working", message: "Preparing your secure SOL claim..." });

      const prepareResponse = await fetch(`/api/token/${encodeURIComponent(mint)}/rewards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare", wallet }),
      });
      const prepared = (await prepareResponse.json()) as { nonce?: string; message?: string; error?: string };

      if (!prepareResponse.ok || !prepared.nonce || !prepared.message) {
        throw new Error(prepared.error ?? "Unable to prepare the SOL claim.");
      }

      setClaim({ kind: "working", message: "Approve the claim message in your wallet. This does not spend SOL." });
      const signed = await signMessage(new TextEncoder().encode(prepared.message));

      setClaim({ kind: "working", message: "Sending your earned Devnet SOL..." });
      const claimResponse = await fetch(`/api/token/${encodeURIComponent(mint)}/rewards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "claim",
          wallet,
          nonce: prepared.nonce,
          message: prepared.message,
          signature: toBase64(signed),
        }),
      });
      const result = (await claimResponse.json()) as { sol?: number; signature?: string; error?: string };

      if (!claimResponse.ok || !result.signature) {
        throw new Error(result.error ?? "The SOL claim could not be completed.");
      }

      setClaim({
        kind: "success",
        message: `${formatSol(result.sol)} SOL was sent to your connected wallet.`,
        signature: result.signature,
      });
      await refresh();
    } catch (error) {
      setClaim({ kind: "error", message: error instanceof Error ? error.message : "The SOL claim could not be completed." });
    }
  };

  return (
    <section className="rounded-3xl border border-amber-300/25 bg-gradient-to-br from-amber-300/[0.08] via-emerald-400/[0.04] to-black p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">$KODIAK SOL Rewards</p>
          <h2 className="mt-2 text-2xl font-black">Hold $KODIAK. Claim SOL.</h2>
        </div>
        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-300">
          Devnet Test
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-zinc-400">
        0.25% equivalent of verified $KODIAK trading volume is allocated to eligible holders. Rewards are earned by the wallets actually holding $KODIAK when each verified trade is recorded.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <RewardMetric label="Claimable" value={`${formatSol(status?.claimableSol)} SOL`} strong />
        <RewardMetric label="Already claimed" value={`${formatSol(status?.lifetimeClaimedSol)} SOL`} />
        <RewardMetric label="Pool generated" value={`${formatSol(status?.generatedSol)} SOL`} />
        <RewardMetric label="Vault balance" value={`${formatSol(status?.vaultSol)} SOL`} />
      </div>

      {!connected ? (
        <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-400">
          Connect the wallet holding $KODIAK to see its claimable SOL.
        </p>
      ) : status?.eligible ? (
        <p className="mt-4 text-xs font-bold text-emerald-300">Connected wallet is an eligible $KODIAK holder.</p>
      ) : (
        <p className="mt-4 text-xs font-bold text-zinc-500">This wallet currently has no $KODIAK balance. Previously accrued rewards, if any, remain attached to the wallet.</p>
      )}

      {!status?.vaultConfigured && (
        <p className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 text-xs leading-5 text-amber-200">
          Devnet rewards are tracking, but the payout vault still needs to be configured before Claim SOL can send funds.
        </p>
      )}

      <button
        type="button"
        onClick={() => void claimSol()}
        disabled={!canClaim}
        className="mt-5 w-full rounded-2xl bg-amber-300 px-5 py-4 text-base font-black text-black transition enabled:hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Claiming..." : "Claim SOL"}
      </button>

      <p
        className={`mt-3 text-xs leading-5 ${
          claim.kind === "error"
            ? "text-red-300"
            : claim.kind === "success"
              ? "text-emerald-300"
              : "text-zinc-500"
        }`}
      >
        {claim.message}
      </p>

      {claim.kind === "success" && (
        <a
          href={kodiakExplorerTransactionUrl(claim.signature)}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs font-black text-amber-300 underline underline-offset-4"
        >
          View claim on Solana Explorer
        </a>
      )}
    </section>
  );
}

function RewardMetric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-600">{label}</p>
      <p className={`mt-1 text-sm font-black ${strong ? "text-amber-300" : "text-white"}`}>{value}</p>
    </div>
  );
}
