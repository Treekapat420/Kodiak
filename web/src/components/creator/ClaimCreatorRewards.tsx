"use client";

import { useEffect, useState } from "react";
import BN from "bn.js";
import {
  DEVNET_PROGRAM_ID,
  getPdaCreatorVault,
  TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";

import {
  KODIAK_LAUNCHPAD_PROGRAM_ID,
  loadKodiakRaydium,
} from "@/lib/raydium/devnet";
import {
  KODIAK_IS_DEVNET,
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

type CpmmLockInfo = {
  name?: string;
  symbol?: string;
  poolInfo: {
    id: string;
    mintA: {
      address: string;
      symbol?: string;
      decimals: number;
    };
    mintB: {
      address: string;
      symbol?: string;
      decimals: number;
    };
    lpMint: {
      address: string;
      decimals: number;
    };
  };
  positionInfo: {
    tvlPercentage?: number;
    usdValue?: number;
    amountA?: number;
    amountB?: number;
    unclaimedFee: {
      lp: number;
      amountA: number;
      amountB: number;
      usdValue?: number;
    };
  };
};

type FeeKeyPosition = {
  nftMint: string;
  info: CpmmLockInfo;
};

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

function uiToRaw(
  value: number,
  decimals: number,
) {
  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return new BN(0);
  }

  const fixed =
    value.toFixed(
      Math.min(
        decimals,
        12,
      ),
    );

  const [
    whole,
    fraction = "",
  ] =
    fixed.split(".");

  const padded =
    fraction
      .padEnd(
        decimals,
        "0",
      )
      .slice(
        0,
        decimals,
      );

  return new BN(
    `${whole}${padded}`.replace(
      /^0+(?=\d)/,
      "",
    ) || "0",
  );
}

function tokenLabel(
  symbol: string | undefined,
  address: string,
) {
  return (
    symbol?.trim() ||
    `${address.slice(0, 4)}...${address.slice(-4)}`
  );
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
    feeKeys,
    setFeeKeys,
  ] =
    useState<FeeKeyPosition[]>(
      [],
    );

  const [
    feeKeysLoading,
    setFeeKeysLoading,
  ] =
    useState(false);

  const [
    claimingFeeKey,
    setClaimingFeeKey,
  ] =
    useState<string | null>(
      null,
    );

  const [
    status,
    setStatus,
  ] = useState<Status>({
    kind: "idle",
    message:
      `Claims use Raydium's real on-chain creator reward systems on Solana ${NETWORK_LABEL}.`,
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

  async function discoverFeeKeys() {
    if (
      !publicKey ||
      !signTransaction ||
      !signAllTransactions
    ) {
      setFeeKeys([]);
      return;
    }

    try {
      setFeeKeysLoading(
        true,
      );

      /*
       * A Raydium CPMM Fee Key is an SPL NFT. Read the connected wallet every
       * time instead of caching the original launch creator, because claim
       * rights follow the current NFT holder.
       */
      const tokenAccounts =
        await connection.getParsedTokenAccountsByOwner(
          publicKey,
          {
            programId:
              TOKEN_PROGRAM_ID,
          },
          "confirmed",
        );

      const candidateMints =
        tokenAccounts.value
          .map((entry) => {
            const parsed =
              entry.account.data
                .parsed as {
                info?: {
                  mint?: string;
                  tokenAmount?: {
                    amount?: string;
                    decimals?: number;
                  };
                };
              };

            const mint =
              parsed.info?.mint;

            const amount =
              parsed.info?.tokenAmount
                ?.amount;

            const decimals =
              parsed.info?.tokenAmount
                ?.decimals;

            if (
              !mint ||
              amount !== "1" ||
              decimals !== 0
            ) {
              return null;
            }

            return mint;
          })
          .filter(
            (
              mint,
            ): mint is string =>
              Boolean(mint),
          );

      if (
        candidateMints.length ===
        0
      ) {
        setFeeKeys([]);
        return;
      }

      const raydium =
        await loadKodiakRaydium({
          connection,
          owner:
            publicKey,
          signTransaction,
          signAllTransactions,
        });

      const api =
        raydium.api as unknown as {
          fetchCpmmLockInfo: (
            key:
              | string
              | PublicKey,
          ) => Promise<CpmmLockInfo>;
        };

      const discovered =
        await Promise.all(
          candidateMints.map(
            async (
              nftMint,
            ): Promise<FeeKeyPosition | null> => {
              try {
                const info =
                  await api.fetchCpmmLockInfo(
                    nftMint,
                  );

                if (
                  !info?.poolInfo
                    ?.id ||
                  !info
                    ?.positionInfo
                    ?.unclaimedFee
                ) {
                  return null;
                }

                return {
                  nftMint,
                  info,
                };
              } catch {
                // Normal wallet NFTs are expected to fail this Raydium lookup.
                return null;
              }
            },
          ),
        );

      setFeeKeys(
        discovered.filter(
          (
            item,
          ): item is FeeKeyPosition =>
            Boolean(item),
        ),
      );
    } catch (error) {
      console.error(
        "Unable to discover CPMM Fee Keys:",
        error,
      );

      setFeeKeys([]);
    } finally {
      setFeeKeysLoading(
        false,
      );
    }
  }

  useEffect(() => {
    const timer =
      window.setTimeout(
        () => {
          void refreshClaimableBalance();
          void discoverFeeKeys();
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
    signTransaction,
    signAllTransactions,
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
          "Building the Raydium LaunchLab creator-fee claim...",
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
          `Approve the ${NETWORK_LABEL} LaunchLab creator-fee claim in your wallet...`,
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
          `Raydium confirmed the pre-graduation creator-fee claim on ${NETWORK_LABEL}.`,
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

  async function claimFeeKey(
    position: FeeKeyPosition,
  ) {
    if (
      !connected ||
      !publicKey ||
      !signTransaction ||
      !signAllTransactions
    ) {
      setStatus({
        kind: "error",
        message:
          `Connect the wallet holding the Fee Key on ${NETWORK_LABEL} first.`,
      });
      return;
    }

    try {
      setClaimingFeeKey(
        position.nftMint,
      );

      setStatus({
        kind: "working",
        message:
          "Verifying Fee Key ownership and loading the graduated CPMM pool...",
      });

      /*
       * Re-check the NFT at claim time. A Fee Key can be transferred, so the
       * wallet that originally created the launch is not sufficient proof.
       */
      const owned =
        await connection.getParsedTokenAccountsByOwner(
          publicKey,
          {
            mint:
              new PublicKey(
                position.nftMint,
              ),
          },
          "confirmed",
        );

      const ownsFeeKey =
        owned.value.some(
          (entry) => {
            const parsed =
              entry.account.data
                .parsed as {
                info?: {
                  tokenAmount?: {
                    amount?: string;
                    decimals?: number;
                  };
                };
              };

            return (
              parsed.info
                ?.tokenAmount
                ?.amount ===
                "1" &&
              parsed.info
                ?.tokenAmount
                ?.decimals ===
                0
            );
          },
        );

      if (!ownsFeeKey) {
        throw new Error(
          "The connected wallet no longer holds this Raydium Fee Key NFT.",
        );
      }

      const raydium =
        await loadKodiakRaydium({
          connection,
          owner:
            publicKey,
          signTransaction,
          signAllTransactions,
        });

      const poolId =
        position.info.poolInfo
          .id;

      const {
        poolInfo,
        poolKeys,
      } =
        await raydium.cpmm.getPoolInfoFromRpc(
          poolId,
        );

      const lpFeeUi =
        position.info
          .positionInfo
          .unclaimedFee.lp;

      const lpFeeAmount =
        uiToRaw(
          lpFeeUi,
          poolInfo.lpMint
            .decimals,
        );

      if (
        lpFeeAmount.isZero()
      ) {
        throw new Error(
          "This Fee Key currently has no CPMM fees available to claim.",
        );
      }

      const params = {
        poolInfo,
        poolKeys,
        nftMint:
          new PublicKey(
            position.nftMint,
          ),
        lpFeeAmount,
        txVersion:
          TxVersion.V0,
        feePayer:
          publicKey,
        closeWsol:
          true,
        ...(KODIAK_IS_DEVNET
          ? {
              programId:
                DEVNET_PROGRAM_ID
                  .LOCK_CPMM_PROGRAM,
              authProgram:
                DEVNET_PROGRAM_ID
                  .LOCK_CPMM_AUTH,
              cpmmProgram: {
                programId:
                  DEVNET_PROGRAM_ID
                    .CREATE_CPMM_POOL_PROGRAM,
                authProgram:
                  DEVNET_PROGRAM_ID
                    .CREATE_CPMM_POOL_AUTH,
              },
            }
          : {}),
      };

      const {
        transaction,
        execute,
      } =
        await raydium.cpmm.harvestLockLp(
          params,
        );

      setStatus({
        kind: "working",
        message:
          "Simulating the Fee Key claim before the wallet can sign...",
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

      if (
        simulation.value.err
      ) {
        throw new Error(
          `Fee Key claim simulation failed: ${JSON.stringify(
            simulation.value.err,
          )}`,
        );
      }

      setStatus({
        kind: "working",
        message:
          `Simulation passed. Approve the ${NETWORK_LABEL} CPMM Fee Key claim in your wallet...`,
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

      await discoverFeeKeys();

      setStatus({
        kind: "success",
        message:
          `Raydium confirmed the post-graduation CPMM fee claim on ${NETWORK_LABEL}.`,
        signature,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof
          Error
            ? error.message
            : "The CPMM Fee Key claim failed.",
      });
    } finally {
      setClaimingFeeKey(
        null,
      );
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
            Creator Rewards
          </h2>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
            Kodiak reads both Raydium creator reward phases: the LaunchLab creator vault before graduation and Fee Key NFT positions after graduation.
          </p>
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
          {busy &&
          !claimingFeeKey
            ? "Claiming..."
            : "Claim Curve Rewards"}
        </button>
      </div>

      <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-black/20 p-4">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">
          Pre-graduation Â· LaunchLab
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
          Live balance from Raydium&apos;s on-chain creator-fee vault.
        </p>
      </div>

      <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/[0.04] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-300">
              Post-graduation Â· CPMM
            </p>

            <h3 className="mt-2 text-lg font-black">
              Fee Key Rewards
            </h3>
          </div>

          <button
            type="button"
            disabled={
              !connected ||
              feeKeysLoading ||
              busy
            }
            onClick={() =>
              void discoverFeeKeys()
            }
            className="rounded-xl border border-amber-300/25 px-3 py-2 text-xs font-black text-amber-300 disabled:opacity-40"
          >
            {feeKeysLoading
              ? "Scanning..."
              : "Refresh Fee Keys"}
          </button>
        </div>

        {!connected ? (
          <p className="mt-4 text-sm text-zinc-500">
            Connect the wallet that holds the creator Fee Key NFT.
          </p>
        ) : feeKeysLoading ? (
          <p className="mt-4 text-sm text-zinc-500">
            Scanning this wallet for Raydium CPMM Fee Keys...
          </p>
        ) : feeKeys.length ===
          0 ? (
          <p className="mt-4 text-sm leading-6 text-zinc-500">
            No Raydium CPMM Fee Key positions were discovered in this wallet. That is expected until one of its eligible launches graduates and the Fee Key NFT is minted.
          </p>
        ) : (
          <div className="mt-4 grid gap-3">
            {feeKeys.map(
              (
                position,
              ) => {
                const {
                  poolInfo,
                  positionInfo,
                } =
                  position.info;

                const hasFees =
                  Number(
                    positionInfo
                      .unclaimedFee
                      .lp,
                  ) > 0;

                return (
                  <div
                    key={
                      position.nftMint
                    }
                    className="rounded-2xl border border-white/10 bg-black/25 p-4"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-black">
                          {tokenLabel(
                            poolInfo
                              .mintA
                              .symbol,
                            poolInfo
                              .mintA
                              .address,
                          )}
                          {" / "}
                          {tokenLabel(
                            poolInfo
                              .mintB
                              .symbol,
                            poolInfo
                              .mintB
                              .address,
                          )}
                        </p>

                        <p className="mt-1 break-all text-xs text-zinc-600">
                          Fee Key:{" "}
                          {
                            position.nftMint
                          }
                        </p>

                        <div className="mt-3 grid gap-1 text-sm">
                          <p>
                            Token A fees:{" "}
                            <span className="font-black text-amber-200">
                              {Number(
                                positionInfo
                                  .unclaimedFee
                                  .amountA ||
                                  0,
                              ).toLocaleString()}
                            </span>
                          </p>

                          <p>
                            Token B fees:{" "}
                            <span className="font-black text-amber-200">
                              {Number(
                                positionInfo
                                  .unclaimedFee
                                  .amountB ||
                                  0,
                              ).toLocaleString()}
                            </span>
                          </p>

                          {Number.isFinite(
                            positionInfo
                              .unclaimedFee
                              .usdValue,
                          ) && (
                            <p className="text-xs text-zinc-500">
                              Estimated value: $
                              {Number(
                                positionInfo
                                  .unclaimedFee
                                  .usdValue ||
                                  0,
                              ).toLocaleString(
                                "en-US",
                                {
                                  maximumFractionDigits:
                                    2,
                                },
                              )}
                            </p>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={
                          busy ||
                          !hasFees
                        }
                        onClick={() =>
                          void claimFeeKey(
                            position,
                          )
                        }
                        className="shrink-0 rounded-xl bg-amber-300 px-4 py-3 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {claimingFeeKey ===
                        position.nftMint
                          ? "Claiming..."
                          : hasFees
                            ? "Claim CPMM Fees"
                            : "No Fees Yet"}
                      </button>
                    </div>
                  </div>
                );
              },
            )}
          </div>
        )}
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
        Fee Key ownership is checked from the connected wallet each time. If the NFT is transferred, the claim right moves with it.
      </p>
    </section>
  );
}
