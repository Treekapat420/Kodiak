"use client";

import { TxVersion } from "@raydium-io/raydium-sdk-v2";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useState } from "react";

import {
  DEVNET_LAUNCHPAD_PROGRAM_ID,
  loadDevnetRaydium,
} from "@/lib/raydium/devnet";

type Status =
  | { kind: "idle"; message: string }
  | { kind: "working"; message: string }
  | { kind: "success"; message: string; signature?: string }
  | { kind: "error"; message: string };

type KodiakConfigResponse = {
  platformId?: string;
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

export function ClaimPlatformRevenue() {
  const { connection } = useConnection();
  const { connected, publicKey, signAllTransactions } = useWallet();

  const [status, setStatus] = useState<Status>({
    kind: "idle",
    message:
      "Claims Kodiak's accumulated Raydium LaunchLab platform fees on Devnet.",
  });

  const busy = status.kind === "working";

  async function claimRevenue() {
    if (!connected || !publicKey || !signAllTransactions) {
      setStatus({
        kind: "error",
        message: "Connect the authorized Kodiak platform wallet first.",
      });
      return;
    }

    try {
      setStatus({
        kind: "working",
        message: "Loading Kodiak's Raydium PlatformConfig...",
      });

      const response = await fetch("/api/config", { cache: "no-store" });

      if (!response.ok) {
        throw new Error(
          `Unable to load Kodiak PlatformConfig (${response.status}).`,
        );
      }

      const config = (await response.json()) as KodiakConfigResponse;

      if (!config.platformId) {
        throw new Error("Kodiak PlatformConfig ID is not available.");
      }

      const platformId = new PublicKey(config.platformId);

      const raydium = await loadDevnetRaydium({
        connection,
        owner: publicKey,
        signAllTransactions,
      });

      setStatus({
        kind: "working",
        message: "Building Kodiak's platform-revenue claim...",
      });

      const { execute } = await raydium.launchpad.claimAllPlatformFee({
        programId: DEVNET_LAUNCHPAD_PROGRAM_ID,
        platformId,
        platformClaimFeeWallet: publicKey,
        txVersion: TxVersion.V0,
        feePayer: publicKey,
      });

      setStatus({
        kind: "working",
        message: "Approve the Kodiak platform-revenue claim in Phantom...",
      });

      const result = await execute({ sendAndConfirm: true });
      const signature = signatureFrom(result);

      setStatus({
        kind: "success",
        message:
          "Raydium confirmed Kodiak's platform-revenue claim on Devnet.",
        signature,
      });
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

  return (
    <section className="mt-6 rounded-[2rem] border border-amber-300/20 bg-amber-300/[0.04] p-5 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">
            Kodiak platform revenue
          </p>
          <h2 className="mt-2 text-2xl font-black">Claim Platform Fees</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Claims accumulated Raydium LaunchLab platform fees for Kodiak&apos;s
            PlatformConfig. This is completely separate from creator rewards.
          </p>
        </div>

        <button
          type="button"
          disabled={!connected || busy}
          onClick={() => void claimRevenue()}
          className="shrink-0 rounded-xl bg-amber-300 px-5 py-3 text-sm font-black text-black transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Claiming..." : "Claim Kodiak Revenue on Devnet"}
        </button>
      </div>

      <div
        className={`mt-5 rounded-2xl border p-4 text-sm ${
          status.kind === "error"
            ? "border-rose-400/20 bg-rose-400/[0.05] text-rose-200"
            : status.kind === "success"
              ? "border-amber-300/20 bg-amber-300/[0.05] text-amber-200"
              : "border-white/10 bg-black/20 text-zinc-500"
        }`}
      >
        <p className="font-bold">{status.message}</p>

        {status.kind === "success" && status.signature ? (
          <a
            href={`https://explorer.solana.com/tx/${status.signature}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block break-all text-xs font-black text-amber-300 underline underline-offset-4"
          >
            View Devnet transaction
          </a>
        ) : null}
      </div>

      <p className="mt-4 text-xs leading-5 text-zinc-600">
        Only the wallet configured as Kodiak&apos;s platform claim-fee wallet
        should authorize this transaction.
      </p>
    </section>
  );
}
