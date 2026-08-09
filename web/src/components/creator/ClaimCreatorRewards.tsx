"use client";

import { useEffect, useState } from "react";
import {
  getPdaCreatorVault,
  TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";

import {
  KODIAK_LAUNCHPAD_PROGRAM_ID,
  loadKodiakRaydium,
} from "@/lib/raydium/devnet";
import {
  kodiakExplorerTransactionUrl,
  kodiakNetworkLabel,
} from "@/lib/solana/network";

type Status =
  | { kind: "idle"; message: string }
  | { kind: "working"; message: string }
  | {
      kind: "success";
      message: string;
      signature?: string;
    }
  | { kind: "error"; message: string };

const NETWORK_LABEL = kodiakNetworkLabel();

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
    const candidate =
      record.txIds.find(
        (item) =>
          typeof item ===
            "string" &&
          item.length > 20,
      );

    if (
      typeof candidate ===
      "string"
    ) {
      return candidate;
    }
  }

  return undefined;
}

export function ClaimCreatorRewards() {
  const { connection } =
    useConnection();

  const {
    connected,
    publicKey,
    signTransaction,
    signAllTransactions,
  } = useWallet();

  const [
    claimableSol,
    setClaimableSol,
  ] = useState<
    number | null
  >(null);

  const [
    status,
    setStatus,
  ] = useState<Status>({
    kind: "idle",
    message:
      `Claims use Raydium LaunchLab's real creator-fee vault on Solana ${NETWORK_LABEL}.`,
  });

  async function refreshClaimableBalance() {
    if (!publicKey) {
      setClaimableSol(
        null,
      );
      return;
    }

    try {
      const creatorVault =
        getPdaCreatorVault(
          KODIAK_LAUNCHPAD_PROGRAM_ID,
          publicKey,
          NATIVE_MINT,
        ).publicKey;

      const accountInfo =
        await connection.getAccountInfo(
          creatorVault,
          "confirmed",
        );

      if (!accountInfo) {
        setClaimableSol(
          0,
        );
        return;
      }

      const balance =
        await connection.getTokenAccountBalance(
          creatorVault,
          "confirmed",
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
        "Unable to read creator vault balance:",
        error,
      );

      setClaimableSol(
        null,
      );
    }
  }

  useEffect(() => {
    const timer =
      window.setTimeout(
        () => {
          void refreshClaimableBalance();
        },
        0,
      );

    return () =>
      window.clearTimeout(
        timer,
      );
  }, [
    publicKey,
    connection,
  ]);

  async function claim() {
    if (
      !connected ||
      !publicKey ||
      !signTransaction ||
      !signAllTransactions
    ) {
      setStatus({
        kind: "error",
        message:
          `Connect a wallet on ${NETWORK_LABEL} first.`,
      });
      return;
    }

    try {
      setStatus({
        kind: "working",
        message:
          "Building the Raydium creator-fee claim...",
      });

      const raydium =
        await loadKodiakRaydium({
          connection,
          owner: publicKey,
          signTransaction,
          signAllTransactions,
        });

      const { execute } =
        await raydium.launchpad.claimCreatorFee(
          {
            programId:
              KODIAK_LAUNCHPAD_PROGRAM_ID,
            mintB:
              NATIVE_MINT,
            mintBProgram:
              TOKEN_PROGRAM_ID,
            txVersion:
              TxVersion.V0,
            feePayer:
              publicKey,
          },
        );

      setStatus({
        kind: "working",
        message:
          `Approve the ${NETWORK_LABEL} creator-fee claim in your wallet...`,
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

      await refreshClaimableBalance();

      setStatus({
        kind: "success",
        message:
          `Raydium confirmed the creator-fee claim on ${NETWORK_LABEL}.`,
        signature,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof
          Error
            ? error.message
            : "The creator-fee claim failed.",
      });
    }
  }

  const busy =
    status.kind ===
    "working";

  return (
    <section className="mt-6 rounded-[2rem] border border-emerald-400/20 bg-emerald-400/[0.04] p-5 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
            On-chain rewards
          </p>

          <h2 className="mt-2 text-2xl font-black">
            Claim Creator
            Rewards
          </h2>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
            Kodiak asks
            Raydium LaunchLab
            to release creator
            fees held for the
            connected creator
            wallet. The Redis
            ledger below remains
            an analytics and
            audit record only.
          </p>

          <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-black/20 p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">
              Raydium
              claimable now
            </p>

            <p className="mt-2 text-2xl font-black text-emerald-300">
              {claimableSol ===
              null
                ? "Loading..."
                : `${claimableSol.toFixed(
                    9,
                  )} SOL`}
            </p>

            <p className="mt-1 text-xs leading-5 text-zinc-600">
              Live balance from
              Raydium&apos;s
              on-chain
              creator-fee
              vault.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={
            !connected ||
            busy
          }
          onClick={() =>
            void claim()
          }
          className="shrink-0 rounded-xl bg-emerald-400 px-5 py-3 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy
            ? "Claiming..."
            : `Claim on ${NETWORK_LABEL}`}
        </button>
      </div>

      <div
        className={`mt-5 rounded-2xl border p-4 text-sm ${
          status.kind ===
          "error"
            ? "border-rose-400/20 bg-rose-400/[0.05] text-rose-200"
            : status.kind ===
                "success"
              ? "border-emerald-400/20 bg-emerald-400/[0.05] text-emerald-200"
              : "border-white/10 bg-black/20 text-zinc-500"
        }`}
      >
        <p className="font-bold">
          {status.message}
        </p>

        {status.kind ===
          "success" &&
        status.signature ? (
          <a
            href={kodiakExplorerTransactionUrl(
              status.signature,
            )}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block break-all text-xs font-black text-emerald-300 underline underline-offset-4"
          >
            View{" "}
            {NETWORK_LABEL}{" "}
            transaction
          </a>
        ) : null}
      </div>

      <p className="mt-4 text-xs leading-5 text-zinc-600">
        The tracked creator
        amount on this page is
        an estimate from
        Kodiak&apos;s recorded
        trades. Raydium&apos;s
        on-chain vault is the
        authority for what can
        actually be claimed.
      </p>
    </section>
  );
}
