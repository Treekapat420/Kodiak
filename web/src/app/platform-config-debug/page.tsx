"use client";

import { getPdaLaunchpadPoolId } from "@raydium-io/raydium-sdk-v2";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useState } from "react";

import {
  DEVNET_LAUNCHPAD_PROGRAM_ID,
  NATIVE_MINT,
  loadDevnetRaydium,
} from "@/lib/raydium/devnet";

const TEST_MINT = "5Kh83v5za9gToxPqEThDAHSg9RUKHKdHoQh6QCkGZmze";

type DebugState =
  | { kind: "idle"; message: string }
  | { kind: "working"; message: string }
  | { kind: "success"; message: string; poolId: string; platformId: string }
  | { kind: "error"; message: string };

export default function PlatformConfigDebugPage() {
  const { connection } = useConnection();
  const { connected, publicKey, signAllTransactions } = useWallet();

  const [state, setState] = useState<DebugState>({
    kind: "idle",
    message: "Connect the same Devnet wallet you use with Kodiak.",
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!connected || !publicKey || !signAllTransactions) {
        setState({
          kind: "idle",
          message: "Connect the same Devnet wallet you use with Kodiak.",
        });
        return;
      }

      try {
        setState({
          kind: "working",
          message: "Reading the existing Kodiak Devnet pool...",
        });

        const mintA = new PublicKey(TEST_MINT);

        const poolId = getPdaLaunchpadPoolId(
          DEVNET_LAUNCHPAD_PROGRAM_ID,
          mintA,
          NATIVE_MINT,
        ).publicKey;

        const raydium = await loadDevnetRaydium({
          connection,
          owner: publicKey,
          signAllTransactions,
        });

        const poolInfo = await raydium.launchpad.getRpcPoolInfo({ poolId });

        if (cancelled) return;

        setState({
          kind: "success",
          message: "Recovered the PlatformConfig used by this Kodiak pool.",
          poolId: poolId.toBase58(),
          platformId: poolInfo.platformId.toBase58(),
        });
      } catch (error) {
        if (cancelled) return;

        setState({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unable to recover PlatformConfig.",
        });
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, signAllTransactions, connection]);

  return (
    <main className="min-h-screen bg-[#070707] px-4 py-8 text-zinc-100 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <a
          href="/dashboard"
          className="inline-flex rounded-xl border border-white/10 px-4 py-3 text-sm font-black"
        >
          Back to dashboard
        </a>

        <section className="mt-6 rounded-[2rem] border border-amber-300/20 bg-amber-300/[0.04] p-5 sm:p-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">
            Devnet diagnostic
          </p>

          <h1 className="mt-2 text-3xl font-black">
            Recover Kodiak PlatformConfig
          </h1>

          <p className="mt-3 text-sm leading-6 text-zinc-500">
            This page reads an existing Kodiak LaunchLab pool and displays the
            PlatformConfig address already attached to that pool. It does not
            create or change any on-chain accounts.
          </p>

          <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">
              Test mint
            </p>
            <p className="mt-2 break-all font-mono text-sm text-zinc-200">
              {TEST_MINT}
            </p>
          </div>

          <div
            className={`mt-5 rounded-2xl border p-4 ${
              state.kind === "error"
                ? "border-rose-400/20 bg-rose-400/[0.05] text-rose-200"
                : state.kind === "success"
                  ? "border-emerald-400/20 bg-emerald-400/[0.05] text-emerald-200"
                  : "border-white/10 bg-black/20 text-zinc-400"
            }`}
          >
            <p className="font-bold">{state.message}</p>

            {state.kind === "success" ? (
              <div className="mt-5 space-y-5">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">
                    Pool ID
                  </p>
                  <p className="mt-2 break-all font-mono text-sm">
                    {state.poolId}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-300">
                    PlatformConfig ID
                  </p>
                  <p className="mt-2 break-all font-mono text-lg font-black text-amber-200">
                    {state.platformId}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
