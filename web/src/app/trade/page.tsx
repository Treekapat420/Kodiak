"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import BN from "bn.js";
import {
  CurveCalculator,
  FeeOn,
  getPdaLaunchpadPoolId,
  PlatformConfig,
  TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { KodiakWalletButton } from "@/components/wallet/KodiakWalletButton";
import { classifyKodiakFailure } from "@/lib/transactionFailure";
import {
  KODIAK_LAUNCHPAD_PROGRAM_ID,
  loadKodiakRaydium,
} from "@/lib/raydium/devnet";
import {
  KODIAK_NETWORK,
  kodiakExplorerAddressUrl,
  kodiakExplorerTransactionUrl,
  kodiakNetworkLabel,
} from "@/lib/solana/network";

type SavedLaunch = {
  network?: string;
  mint?: string;
  name?: string;
  symbol?: string;
};

type KodiakConfigResponse = {
  platformId?: string;
  network?: string;
  error?: string;
};

type GraduationState = {
  network: string;
  mint: string;
  state: "active" | "graduated" | "cancelled" | "unknown";
  rawStatus: number;
  migrateType: "cpmm" | "amm";
  launchpadPoolId: string;
  platformId: string;
  cpConfigId: string | null;
  cpmmPoolId: string | null;
  bonding: {
    quoteCollectedRaw: string;
    quoteTargetRaw: string;
    progressBps: number;
    progressPercent: number;
    thresholdReached: boolean;
  };
  trading: {
    launchpadActive: boolean;
    graduationReady: boolean;
    graduated: boolean;
    cancelled: boolean;
    cpmmReady: boolean;
  };
};

type Status =
  | { kind: "idle"; message: string }
  | { kind: "working"; message: string }
  | { kind: "success"; message: string; signature?: string }
  | { kind: "error"; message: string; logs?: string[]; code?: string; action?: string; technical?: string };

const LAMPORTS_PER_SOL = 1_000_000_000;
// Keep a small SOL cushion for network fees and any token-account setup
// the wallet may need during a buy (for example WSOL/token ATAs).
const BUY_SOL_RESERVE_LAMPORTS = 10_000_000; // 0.01 SOL
const TRADE_SLIPPAGE = new BN(100);
const NETWORK_LABEL = kodiakNetworkLabel();

const lastLaunchStorageKey =
  `kodiak-last-${KODIAK_NETWORK}-launch`;

function collectSignature(value: unknown): string | undefined {
  if (typeof value === "string" && value.length >= 64) return value;

  if (Array.isArray(value)) {
    for (const item of value) {
      const signature = collectSignature(item);
      if (signature) return signature;
    }
  }

  if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (
        ["txId", "txid", "signature"].includes(key) &&
        typeof item === "string"
      ) {
        return item;
      }

      const signature = collectSignature(item);
      if (signature) return signature;
    }
  }

  return undefined;
}

function extractLogs(error: unknown): string[] | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "logs" in error &&
    Array.isArray(error.logs)
  ) {
    return error.logs.filter(
      (entry): entry is string => typeof entry === "string",
    );
  }

  return undefined;
}

function decimalToRawAmount(value: string, decimals: number): BN {
  const trimmed = value.trim();

  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Enter a valid token amount.");
  }

  const [whole, fraction = ""] = trimmed.split(".");
  const padded = fraction.padEnd(decimals, "0").slice(0, decimals);

  return new BN(whole || "0")
    .mul(new BN(10).pow(new BN(decimals)))
    .add(new BN(padded || "0"));
}

function rawAmountToDecimalString(
  amount: BN,
  decimals: number,
) {
  const scale =
    new BN(10).pow(
      new BN(decimals),
    );

  const whole =
    amount.div(scale).toString();

  if (decimals === 0) {
    return whole;
  }

  const fraction =
    amount
      .mod(scale)
      .toString()
      .padStart(
        decimals,
        "0",
      )
      .replace(
        /0+$/,
        "",
      );

  return fraction
    ? `${whole}.${fraction}`
    : whole;
}

async function getKodiakPlatformId(): Promise<PublicKey> {
  const response =
    await fetch(
      "/api/config",
      {
        cache:
          "no-store",
      },
    );

  const payload =
    (await response.json()) as KodiakConfigResponse;

  if (
    !response.ok ||
    !payload.platformId
  ) {
    throw new Error(
      payload.error ||
        `Kodiak's ${NETWORK_LABEL} PlatformConfig is unavailable.`,
    );
  }

  if (
    payload.network &&
    payload.network !==
      KODIAK_NETWORK
  ) {
    throw new Error(
      `Kodiak config returned ${payload.network}, but the trading client is running on ${KODIAK_NETWORK}.`,
    );
  }

  return new PublicKey(
    payload.platformId,
  );
}

function assertKodiakLaunchpadPool(
  poolPlatformId: PublicKey,
  kodiakPlatformId: PublicKey,
) {
  if (
    !poolPlatformId.equals(
      kodiakPlatformId,
    )
  ) {
    throw new Error(
      "This LaunchLab token does not belong to Kodiak's active PlatformConfig. Kodiak will not prepare a trade for another LaunchLab platform.",
    );
  }
}

export default function TradePage() {
  const { connection } = useConnection();

  const {
    connected,
    publicKey,
    signTransaction,
    signAllTransactions,
  } = useWallet();

  const [mintText, setMintText] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [buySol, setBuySol] = useState("0.001");
  const [poolIdText, setPoolIdText] = useState("");
  const [estimatedTokens, setEstimatedTokens] =
    useState<string | null>(null);
  const [walletSol, setWalletSol] = useState<string | null>(null);
  const [tradeMode, setTradeMode] =
    useState<"buy" | "sell">("buy");
  const [sellTokens, setSellTokens] = useState("");
  const [tokenBalance, setTokenBalance] =
    useState<number | null>(null);
  const [tokenDecimals, setTokenDecimals] =
    useState<number | null>(null);
  const [estimatedSellSol, setEstimatedSellSol] =
    useState<string | null>(null);
  const [graduationState, setGraduationState] =
    useState<GraduationState | null>(null);
  const [graduationLoading, setGraduationLoading] =
    useState(false);

  const [status, setStatus] = useState<Status>({
    kind: "idle",
    message:
      `Load the last Kodiak launch or paste a ${NETWORK_LABEL} mint.`,
  });

  const transactionDiagnosticRef = useRef("");

  const normalizedMint = mintText.trim();

  const mintIsValid = useMemo(() => {
    try {
      new PublicKey(normalizedMint);
      return true;
    } catch {
      return false;
    }
  }, [normalizedMint]);

  useEffect(() => {
    if (!publicKey) {
      setWalletSol(null);
      return;
    }

    let cancelled = false;

    void connection
      .getBalance(publicKey, "confirmed")
      .then((lamports) => {
        if (!cancelled) {
          setWalletSol(
            (lamports / LAMPORTS_PER_SOL).toFixed(4),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setWalletSol(null);
      });

    return () => {
      cancelled = true;
    };
  }, [connection, publicKey, status.kind]);

  useEffect(() => {
    if (!publicKey || !mintIsValid) {
      setTokenBalance(null);
      setTokenDecimals(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const mintA = new PublicKey(normalizedMint);

        const [supply, accounts] = await Promise.all([
          connection.getTokenSupply(mintA, "confirmed"),
          connection.getParsedTokenAccountsByOwner(
            publicKey,
            { mint: mintA },
            "confirmed",
          ),
        ]);

        let total = 0;

        for (const account of accounts.value) {
          const data = account.account.data;

          if ("parsed" in data) {
            const amount = data.parsed?.info?.tokenAmount;

            const ui =
              typeof amount?.uiAmount === "number"
                ? amount.uiAmount
                : Number(amount?.uiAmountString ?? "0");

            if (Number.isFinite(ui)) total += ui;
          }
        }

        if (!cancelled) {
          setTokenDecimals(supply.value.decimals);
          setTokenBalance(total);
        }
      } catch {
        if (!cancelled) {
          setTokenBalance(0);
          setTokenDecimals(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    connection,
    publicKey,
    mintIsValid,
    normalizedMint,
    status.kind,
  ]);

  const loadGraduationState = async (
    mint: string,
    options?: {
      silent?: boolean;
    },
  ) => {
    if (!mint) {
      setGraduationState(null);
      return null;
    }

    try {
      if (!options?.silent) {
        setGraduationLoading(true);
      }

      const response = await fetch(
        `/api/token/${encodeURIComponent(
          mint,
        )}/graduation`,
        {
          cache: "no-store",
        },
      );

      const data =
        (await response.json()) as
          | GraduationState
          | {
              error?: string;
            };

      if (!response.ok) {
        throw new Error(
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : "Unable to read graduation state.",
        );
      }

      const state =
        data as GraduationState;

      if (
        state.network !==
        KODIAK_NETWORK
      ) {
        throw new Error(
          `Graduation API returned ${state.network}, but Kodiak is running on ${KODIAK_NETWORK}.`,
        );
      }

      setGraduationState(state);

      if (state.launchpadPoolId) {
        setPoolIdText(
          state.launchpadPoolId,
        );
      }

      return state;
    } catch (error) {
      if (!options?.silent) {
        setGraduationState(null);
      }

      throw error;
    } finally {
      if (!options?.silent) {
        setGraduationLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!mintIsValid) {
      setGraduationState(null);
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/token/${encodeURIComponent(
            normalizedMint,
          )}/graduation`,
          {
            cache: "no-store",
          },
        );

        if (!response.ok) {
          return;
        }

        const state =
          (await response.json()) as GraduationState;

        if (
          state.network !==
          KODIAK_NETWORK
        ) {
          return;
        }

        if (!cancelled) {
          setGraduationState(
            state,
          );

          if (
            state.launchpadPoolId
          ) {
            setPoolIdText(
              state.launchpadPoolId,
            );
          }
        }
      } catch {
        // Polling is best-effort. Explicit loads still surface errors.
      }
    };

    void refresh();

    const timer =
      window.setInterval(
        () => {
          void refresh();
        },
        15_000,
      );

    return () => {
      cancelled = true;
      window.clearInterval(
        timer,
      );
    };
  }, [
    mintIsValid,
    normalizedMint,
  ]);

  const loadLastLaunch = () => {
    const raw = window.localStorage.getItem(
      lastLaunchStorageKey,
    );

    if (!raw) {
      setStatus({
        kind: "error",
        message:
          `No saved Kodiak ${NETWORK_LABEL} launch was found in this browser.`,
      });
      return;
    }

    try {
      const launch = JSON.parse(raw) as SavedLaunch;

      if (
        launch.network &&
        launch.network !== KODIAK_NETWORK
      ) {
        throw new Error(
          `The saved launch belongs to ${launch.network}, not ${KODIAK_NETWORK}.`,
        );
      }

      if (!launch.mint) {
        throw new Error(
          "The saved launch does not contain a mint address.",
        );
      }

      setMintText(launch.mint);
      setTokenName(launch.name ?? "");
      setTokenSymbol(launch.symbol ?? "");
      setPoolIdText("");
      setEstimatedTokens(null);
      setEstimatedSellSol(null);
      setSellTokens("");
      setGraduationState(null);

      setStatus({
        kind: "idle",
        message:
          "Saved Kodiak launch loaded. Now load its bonding curve.",
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The saved launch could not be read.",
      });
    }
  };

  const loadPool = async () => {
    if (!mintIsValid) {
      setStatus({
        kind: "error",
        message: "Enter a valid Solana token mint.",
      });
      return;
    }

    if (
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
          `Reading Kodiak's live LaunchLab/graduation state on ${NETWORK_LABEL}...`,
      });

      const graduation =
        await loadGraduationState(
          normalizedMint,
        );

      if (!graduation) {
        throw new Error(
          "Kodiak could not read this token's graduation state.",
        );
      }

      if (
        graduation.trading.cancelled
      ) {
        setStatus({
          kind: "error",
          message:
            "This LaunchLab pool is cancelled. Bonding-curve trading is disabled.",
        });
        return;
      }

      if (
        graduation.trading.graduated
      ) {
        if (
          graduation.trading.cpmmReady &&
          graduation.cpmmPoolId
        ) {
          setStatus({
            kind: "success",
            message:
              "This token has graduated from LaunchLab. Kodiak found its Raydium CPMM pool.",
          });
        } else {
          setStatus({
            kind: "working",
            message:
              "This token is graduated. Kodiak is waiting for the resulting Raydium CPMM pool to become available.",
          });
        }

        return;
      }

      if (
        graduation.trading.graduationReady
      ) {
        setStatus({
          kind: "working",
          message:
            "Bonding target reached. LaunchLab curve trading is paused while this token is ready for graduation.",
        });
        return;
      }

      const mintA =
        new PublicKey(
          normalizedMint,
        );

      const poolId =
        new PublicKey(
          graduation.launchpadPoolId,
        );

      const raydium = await loadKodiakRaydium({
        connection,
        owner: publicKey,
        signTransaction,
        signAllTransactions,
      });

      await raydium.launchpad.getRpcPoolInfo({
        poolId,
      });

      setPoolIdText(
        poolId.toBase58(),
      );

      setStatus({
        kind: "success",
        message:
          `LaunchLab bonding-curve pool loaded from ${NETWORK_LABEL}.`,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to load the LaunchLab pool.",
        logs: extractLogs(error),
      });
    }
  };

  async function recordTrade(input: {
    mint: PublicKey;
    signature: string;
    side: "buy" | "sell";
    solAmount?: number;
    tokenAmount?: number;
  }) {
    let recorded = false;

    for (
      let attempt = 0;
      attempt < 5 && !recorded;
      attempt += 1
    ) {
      if (attempt > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, 2500),
        );
      }

      const response = await fetch(
        `/api/token/${input.mint.toBase58()}/trades`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            wallet: publicKey?.toBase58(),
            signature: input.signature,
            side: input.side,
            ...(input.solAmount !== undefined
              ? { solAmount: input.solAmount }
              : {}),
            ...(input.tokenAmount !== undefined
              ? { tokenAmount: input.tokenAmount }
              : {}),
          }),
        },
      );

      if (response.ok) {
        recorded = true;
        break;
      }

      if (response.status !== 409) {
        const payload = await response
          .json()
          .catch(() => null);

        throw new Error(
          payload?.error ||
            `The ${input.side} succeeded, but chart recording failed.`,
        );
      }
    }

    return recorded;
  }

  async function executeCpmmBuy({
    graduation,
    solNumber,
    lamports,
  }: {
    graduation: GraduationState;
    solNumber: number;
    lamports: number;
  }) {
    if (
      !publicKey ||
      !signTransaction ||
      !signAllTransactions ||
      !graduation.cpmmPoolId
    ) {
      throw new Error(
        "Kodiak cannot prepare this CPMM buy yet.",
      );
    }

    setEstimatedTokens(null);

    const mintA =
      new PublicKey(
        normalizedMint,
      );

    const raydium =
      await loadKodiakRaydium({
        connection,
        owner:
          publicKey,
        signTransaction,
        signAllTransactions,
      });

    const inputAmount =
      new BN(
        lamports,
      );

    const buildCpmmBuy =
      async () => {
        const {
          poolInfo,
          poolKeys,
          rpcData,
        } =
          await raydium.cpmm.getPoolInfoFromRpc(
            graduation.cpmmPoolId!,
          );

        const inputMint =
          NATIVE_MINT.toBase58();

        if (
          inputMint !==
            poolInfo.mintA.address &&
          inputMint !==
            poolInfo.mintB.address
        ) {
          throw new Error(
            "The graduated CPMM pool does not contain wrapped SOL.",
          );
        }

        const outputMint =
          inputMint ===
          poolInfo.mintA.address
            ? poolInfo.mintB.address
            : poolInfo.mintA.address;

        if (
          outputMint !==
          mintA.toBase58()
        ) {
          throw new Error(
            "The graduated CPMM pool does not match this Kodiak token.",
          );
        }

        const baseIn =
          inputMint ===
          poolInfo.mintA.address;

        const configInfo =
          rpcData.configInfo;

        if (!configInfo) {
          throw new Error(
            "Raydium CPMM fee configuration is unavailable.",
          );
        }

        const swapResult =
          CurveCalculator.swapBaseInput(
            inputAmount,
            baseIn
              ? rpcData.baseReserve
              : rpcData.quoteReserve,
            baseIn
              ? rpcData.quoteReserve
              : rpcData.baseReserve,
            configInfo.tradeFeeRate,
            configInfo.creatorFeeRate,
            configInfo.protocolFeeRate,
            configInfo.fundFeeRate,
            rpcData.feeOn ===
                FeeOn.BothToken ||
              rpcData.feeOn ===
                FeeOn.OnlyTokenB,
          );

        const outputDecimals =
          baseIn
            ? poolInfo.mintB.decimals
            : poolInfo.mintA.decimals;

        const built =
          await raydium.cpmm.swap({
            poolInfo,
            poolKeys,
            inputAmount,
            swapResult,
            slippage:
              0.01,
            baseIn,
            txVersion:
              TxVersion.V0,
            config: {
              associatedOnly:
                false,
              checkCreateATAOwner:
                true,
            },
          });

        return {
          ...built,
          estimatedOutput:
            rawAmountToDecimalString(
              swapResult.outputAmount,
              outputDecimals,
            ),
        };
      };

    setStatus({
      kind: "working",
      message:
        "Loading the graduated Raydium CPMM pool and calculating the purchase...",
    });

    const simulationBuild =
      await buildCpmmBuy();

    setEstimatedTokens(
      simulationBuild.estimatedOutput,
    );

    setStatus({
      kind: "working",
      message:
        "Simulating the CPMM buy before the wallet can sign...",
    });

    const simulation =
      simulationBuild.transaction instanceof
      VersionedTransaction
        ? await connection.simulateTransaction(
            simulationBuild.transaction,
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
            simulationBuild.transaction,
          );

    if (
      simulation.value.err
    ) {
      setStatus({
        kind: "error",
        message:
          `CPMM buy simulation failed: ${JSON.stringify(
            simulation.value.err,
          )}`,
        logs:
          simulation.value.logs ??
          [],
      });

      return;
    }

    setStatus({
      kind: "working",
      message:
        "Simulation passed. Refreshing CPMM reserves and rebuilding the buy before wallet approval...",
    });

    const liveGraduation =
      await loadGraduationState(
        normalizedMint,
        {
          silent:
            true,
        },
      );

    if (
      !liveGraduation ||
      !liveGraduation.trading.graduated ||
      !liveGraduation.trading.cpmmReady ||
      liveGraduation.cpmmPoolId !==
        graduation.cpmmPoolId
    ) {
      throw new Error(
        "The token's graduation/CPMM state changed after simulation. No wallet request was opened; refresh and try again.",
      );
    }

    const freshBuild =
      await buildCpmmBuy();

    setEstimatedTokens(
      freshBuild.estimatedOutput,
    );

    setStatus({
      kind: "working",
      message:
        `Fresh CPMM quote built after simulation. Approve the ${NETWORK_LABEL} buy in your wallet...`,
    });

    if (!(freshBuild.transaction instanceof VersionedTransaction)) {
      throw new Error(
        "Kodiak expected a versioned CPMM buy transaction before wallet approval.",
      );
    }

    const signature =
      await sendFreshWalletTransaction(
        freshBuild.transaction,
      );

    if (!signature) {
      throw new Error(
        "The CPMM purchase succeeded, but no transaction signature was returned.",
      );
    }

    setStatus({
      kind: "working",
      message:
        "CPMM purchase confirmed. Updating the token chart...",
    });

    const recorded =
      await recordTrade({
        mint:
          mintA,
        signature,
        side:
          "buy",
        solAmount:
          solNumber,
      });

    await loadGraduationState(
      normalizedMint,
      {
        silent:
          true,
      },
    ).catch(
      () => null,
    );

    setStatus({
      kind: "success",
      message:
        recorded
          ? `${solNumber} ${NETWORK_LABEL} SOL CPMM purchase confirmed and added to the chart.`
          : `${solNumber} ${NETWORK_LABEL} SOL CPMM purchase confirmed. Chart indexing is still pending.`,
      signature,
    });
  }

  async function executeCpmmSell({
    graduation,
    rawSellAmount,
    sellNumber,
  }: {
    graduation: GraduationState;
    rawSellAmount: BN;
    sellNumber: number;
  }) {
    if (
      !publicKey ||
      !signTransaction ||
      !signAllTransactions ||
      !graduation.cpmmPoolId
    ) {
      throw new Error(
        "Kodiak cannot prepare this CPMM sell yet.",
      );
    }

    setEstimatedSellSol(
      null,
    );

    const mintA =
      new PublicKey(
        normalizedMint,
      );

    const raydium =
      await loadKodiakRaydium({
        connection,
        owner:
          publicKey,
        signTransaction,
        signAllTransactions,
      });

    const buildCpmmSell =
      async () => {
        const {
          poolInfo,
          poolKeys,
          rpcData,
        } =
          await raydium.cpmm.getPoolInfoFromRpc(
            graduation.cpmmPoolId!,
          );

        const inputMint =
          mintA.toBase58();

        if (
          inputMint !==
            poolInfo.mintA.address &&
          inputMint !==
            poolInfo.mintB.address
        ) {
          throw new Error(
            "The graduated CPMM pool does not match this Kodiak token.",
          );
        }

        const outputMint =
          inputMint ===
          poolInfo.mintA.address
            ? poolInfo.mintB.address
            : poolInfo.mintA.address;

        if (
          outputMint !==
          NATIVE_MINT.toBase58()
        ) {
          throw new Error(
            "The graduated CPMM pool does not contain wrapped SOL.",
          );
        }

        const baseIn =
          inputMint ===
          poolInfo.mintA.address;

        const configInfo =
          rpcData.configInfo;

        if (!configInfo) {
          throw new Error(
            "Raydium CPMM fee configuration is unavailable.",
          );
        }

        const swapResult =
          CurveCalculator.swapBaseInput(
            rawSellAmount,
            baseIn
              ? rpcData.baseReserve
              : rpcData.quoteReserve,
            baseIn
              ? rpcData.quoteReserve
              : rpcData.baseReserve,
            configInfo.tradeFeeRate,
            configInfo.creatorFeeRate,
            configInfo.protocolFeeRate,
            configInfo.fundFeeRate,
            rpcData.feeOn ===
                FeeOn.BothToken ||
              rpcData.feeOn ===
                FeeOn.OnlyTokenB,
          );

        const estimatedLamports =
          Number(
            swapResult.outputAmount.toString(),
          );

        const built =
          await raydium.cpmm.swap({
            poolInfo,
            poolKeys,
            inputAmount:
              rawSellAmount,
            swapResult,
            slippage:
              0.01,
            baseIn,
            txVersion:
              TxVersion.V0,
            config: {
              associatedOnly:
                false,
              checkCreateATAOwner:
                true,
            },
          });

        return {
          ...built,
          estimatedLamports,
        };
      };

    setStatus({
      kind: "working",
      message:
        "Loading the graduated Raydium CPMM pool and calculating the sale...",
    });

    const simulationBuild =
      await buildCpmmSell();

    if (
      Number.isFinite(
        simulationBuild.estimatedLamports,
      )
    ) {
      setEstimatedSellSol(
        (
          simulationBuild.estimatedLamports /
          LAMPORTS_PER_SOL
        ).toFixed(
          9,
        ),
      );
    }

    setStatus({
      kind: "working",
      message:
        "Simulating the CPMM sell before the wallet can sign...",
    });

    const simulation =
      simulationBuild.transaction instanceof
      VersionedTransaction
        ? await connection.simulateTransaction(
            simulationBuild.transaction,
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
            simulationBuild.transaction,
          );

    if (
      simulation.value.err
    ) {
      setStatus({
        kind: "error",
        message:
          `CPMM sell simulation failed: ${JSON.stringify(
            simulation.value.err,
          )}`,
        logs:
          simulation.value.logs ??
          [],
      });

      return;
    }

    setStatus({
      kind: "working",
      message:
        "Simulation passed. Refreshing CPMM reserves and rebuilding the sell before wallet approval...",
    });

    const liveGraduation =
      await loadGraduationState(
        normalizedMint,
        {
          silent:
            true,
        },
      );

    if (
      !liveGraduation ||
      !liveGraduation.trading.graduated ||
      !liveGraduation.trading.cpmmReady ||
      liveGraduation.cpmmPoolId !==
        graduation.cpmmPoolId
    ) {
      throw new Error(
        "The token's graduation/CPMM state changed after simulation. No wallet request was opened; refresh and try again.",
      );
    }

    const freshBuild =
      await buildCpmmSell();

    if (
      Number.isFinite(
        freshBuild.estimatedLamports,
      )
    ) {
      setEstimatedSellSol(
        (
          freshBuild.estimatedLamports /
          LAMPORTS_PER_SOL
        ).toFixed(
          9,
        ),
      );
    }

    setStatus({
      kind: "working",
      message:
        `Fresh CPMM quote built after simulation. Approve the ${NETWORK_LABEL} sell in your wallet...`,
    });

    if (!(freshBuild.transaction instanceof VersionedTransaction)) {
      throw new Error(
        "Kodiak expected a versioned CPMM sell transaction before wallet approval.",
      );
    }

const signature =
      await sendFreshWalletTransaction(
        freshBuild.transaction,
      );

    if (!signature) {
      throw new Error(
        "The CPMM sale succeeded, but no transaction signature was returned.",
      );
    }

    setStatus({
      kind: "working",
      message:
        "CPMM sale confirmed. Updating the token chart...",
    });

    const solAmount =
      Number.isFinite(
        freshBuild.estimatedLamports,
      )
        ? freshBuild.estimatedLamports /
          LAMPORTS_PER_SOL
        : undefined;

    const recorded =
      await recordTrade({
        mint:
          mintA,
        signature,
        side:
          "sell",
        solAmount,
        tokenAmount:
          sellNumber,
      });

    setSellTokens(
      "",
    );

    await loadGraduationState(
      normalizedMint,
      {
        silent:
          true,
      },
    ).catch(
      () => null,
    );

    setStatus({
      kind: "success",
      message:
        recorded
          ? `${sellNumber.toLocaleString()} tokens sold through CPMM and added to the chart.`
          : `${sellNumber.toLocaleString()} tokens sold through CPMM. Chart indexing is still pending.`,
      signature,
    });
  }

  const diagnoseWalletTransaction = async (
    transaction: VersionedTransaction,
    label: string,
  ) => {
    const serializedBytes = transaction.serialize().length;
    const requiredSigners =
      transaction.message.header.numRequiredSignatures;
    const staticAccounts =
      transaction.message.staticAccountKeys.length;
    const instructionCount =
      transaction.message.compiledInstructions.length;

    const instructionDetails =
      transaction.message.compiledInstructions.map(
        (instruction, index) => {
          const programId =
            transaction.message.staticAccountKeys[
              instruction.programIdIndex
            ]?.toBase58() ??
            `lookup-index-${instruction.programIdIndex}`;

          const accountIndexes =
            Array.from(
              instruction.accountKeyIndexes,
            );

          const dataPrefix =
            Array.from(
              instruction.data.slice(
                0,
                12,
              ),
            )
              .map((byte) =>
                byte
                  .toString(16)
                  .padStart(2, "0"),
              )
              .join("");

          return {
            index,
            programId,
            accountIndexes,
            dataLength:
              instruction.data.length,
            dataPrefix,
          };
        },
      );

    const uniqueProgramIds =
      Array.from(
        new Set(
          instructionDetails.map(
            (instruction) =>
              instruction.programId,
          ),
        ),
      );

    const simulation = await connection.simulateTransaction(
      transaction,
      {
        commitment: "confirmed",
        replaceRecentBlockhash: true,
        sigVerify: false,
      },
    );

    const programSummary =
      uniqueProgramIds.join(", ");

    const instructionSummary =
      instructionDetails
        .map(
          (instruction) =>
            `#${instruction.index + 1} ${instruction.programId} ` +
            `accounts[${instruction.accountIndexes.join(",")}] ` +
            `data=${instruction.dataLength}B:${instruction.dataPrefix}`,
        )
        .join(" | ");

    const summary =
      `${label}: ${serializedBytes} serialized bytes, ` +
      `${requiredSigners} required signer(s), ` +
      `${staticAccounts} static account(s), ` +
      `${instructionCount} instruction(s), ` +
      `RPC simulation ${simulation.value.err ? "FAILED" : "PASSED"}. ` +
      `Programs: ${programSummary}. ` +
      `Instructions: ${instructionSummary}.`;

    console.info("[Kodiak transaction diagnostic]", {
      label,
      serializedBytes,
      requiredSigners,
      staticAccounts,
      instructionCount,
      uniqueProgramIds,
      instructionDetails,
      simulationError: simulation.value.err,
      unitsConsumed: simulation.value.unitsConsumed ?? null,
      logs: simulation.value.logs ?? [],
    });

    transactionDiagnosticRef.current = summary;

    if (serializedBytes >= 1232) {
      throw new Error(
        `${summary} Kodiak stopped before wallet handoff because the transaction meets or exceeds Solana's 1,232-byte serialized transaction limit.`,
      );
    }

    if (simulation.value.err) {
      throw new Error(
        `${summary} Kodiak stopped before wallet handoff because the exact transaction failed RPC simulation: ${JSON.stringify(simulation.value.err)}`,
      );
    }

    console.info(
      `[Kodiak transaction diagnostic] ${summary} Opening Phantom with this exact transaction...`,
    );

    return {
      serializedBytes,
      requiredSigners,
      staticAccounts,
      instructionCount,
      unitsConsumed: simulation.value.unitsConsumed ?? null,
    };
  };

  const sendFreshWalletTransaction = async (
    transaction: VersionedTransaction,
  ): Promise<string> => {
    if (!signTransaction) {
      throw new Error(`Connect a wallet on ${NETWORK_LABEL} first.`);
    }

    /*
     * Phantom-safe handoff:
     *
     * Raydium's execute() helper can add/sign/send internally before Phantom
     * receives the request. Kodiak instead refreshes the blockhash at the last
     * possible moment, clears any stale signatures, lets the connected wallet
     * sign the exact transaction first, then broadcasts those signed bytes.
     * This is the same handoff pattern used by Kodiak's working Mainnet launch.
     */
    const latestBlockhash =
      await connection.getLatestBlockhash("confirmed");

    transaction.message.recentBlockhash =
      latestBlockhash.blockhash;

    transaction.signatures =
      transaction.signatures.map(() => new Uint8Array(64));

    const walletSignedTransaction =
      await signTransaction(transaction);

    const signature =
      await connection.sendRawTransaction(
        walletSignedTransaction.serialize(),
        {
          skipPreflight: false,
          maxRetries: 5,
        },
      );

    const confirmation =
      await connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        "confirmed",
      );

    if (confirmation.value.err) {
      throw new Error(
        `The ${NETWORK_LABEL} transaction was submitted but failed on-chain: ${JSON.stringify(
          confirmation.value.err,
        )}`,
      );
    }

    return signature;
  };

  const buyToken = async () => {
    if (
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

    if (!mintIsValid) {
      setStatus({
        kind: "error",
        message:
          `Enter or load a valid ${NETWORK_LABEL} mint first.`,
      });
      return;
    }

    let liveGraduation:
      GraduationState | null =
      null;

    try {
      liveGraduation =
        await loadGraduationState(
          normalizedMint,
          {
            silent:
              true,
          },
        );

      if (
        liveGraduation?.trading.graduationReady
      ) {
        setStatus({
          kind: "error",
          message:
            "This token has reached its bonding target. Trading is paused while graduation completes.",
        });
        return;
      }

      if (
        liveGraduation?.trading.cancelled
      ) {
        setStatus({
          kind: "error",
          message:
            "This LaunchLab pool is cancelled.",
        });
        return;
      }

      if (
        liveGraduation?.trading.graduated &&
        !liveGraduation.trading.cpmmReady
      ) {
        setStatus({
          kind: "error",
          message:
            "This token has graduated and Kodiak is waiting for its Raydium CPMM pool.",
        });
        return;
      }
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Kodiak could not verify the token's graduation state.",
      });
      return;
    }

    const solNumber = Number(buySol);

    if (
      !Number.isFinite(solNumber) ||
      solNumber <= 0 ||
      solNumber > 5
    ) {
      setStatus({
        kind: "error",
        message:
          `Enter a ${NETWORK_LABEL} SOL amount greater than 0 and no more than 5.`,
      });
      return;
    }

    const lamports = Math.round(
      solNumber * LAMPORTS_PER_SOL,
    );

    if (
      !Number.isSafeInteger(lamports) ||
      lamports <= 0
    ) {
      setStatus({
        kind: "error",
        message:
          "The SOL amount could not be converted to lamports.",
      });
      return;
    }

    // Catch an obviously underfunded buy before Raydium builds/simulates it.
    // A little SOL is intentionally left untouched for transaction fees and
    // possible associated-token-account setup. This produces a useful Kodiak
    // error instead of exposing a low-level LaunchLab simulation failure.
    try {
      const walletLamports =
        await connection.getBalance(
          publicKey,
          "confirmed",
        );

      setWalletSol(
        (walletLamports / LAMPORTS_PER_SOL).toFixed(4),
      );

      const minimumRequiredLamports =
        lamports + BUY_SOL_RESERVE_LAMPORTS;

      if (walletLamports < minimumRequiredLamports) {
        const availableSol =
          walletLamports / LAMPORTS_PER_SOL;
        const requestedSol =
          lamports / LAMPORTS_PER_SOL;
        const reserveSol =
          BUY_SOL_RESERVE_LAMPORTS / LAMPORTS_PER_SOL;
        const maxSpendableSol = Math.max(
          0,
          (walletLamports - BUY_SOL_RESERVE_LAMPORTS) /
            LAMPORTS_PER_SOL,
        );

        setStatus({
          kind: "error",
          message:
            `Insufficient SOL. This wallet has about ${availableSol.toFixed(4)} SOL, but the requested buy is ${requestedSol.toFixed(4)} SOL.`,
          action:
            `Lower the buy amount or add SOL to the wallet. Kodiak keeps about ${reserveSol.toFixed(2)} SOL available for network fees and token-account setup. Maximum suggested buy right now: ${maxSpendableSol.toFixed(4)} SOL.`,
          code: "INSUFFICIENT_FUNDS",
          technical:
            `Wallet balance: ${walletLamports} lamports; requested buy: ${lamports} lamports; safety reserve: ${BUY_SOL_RESERVE_LAMPORTS} lamports.`,
        });
        return;
      }
    } catch (error) {
      // A temporary balance-RPC failure should not block a legitimate trade.
      // The normal simulation remains the final safety gate below.
      console.warn(
        "Kodiak could not preflight the wallet SOL balance:",
        error,
      );
    }

    if (
      liveGraduation?.trading.graduated &&
      liveGraduation.trading.cpmmReady
    ) {
      try {
        await executeCpmmBuy({
          graduation:
            liveGraduation,
          solNumber,
          lamports,
        });
      } catch (error) {
        const failure = classifyKodiakFailure(
          error,
          `The ${NETWORK_LABEL} CPMM purchase failed.`,
        );
        setStatus({
          kind: "error",
          message: failure.message,
          action: failure.action,
          code: failure.code,
          technical: failure.technical,
          logs: extractLogs(error),
        });
      }

      return;
    }

    try {
      transactionDiagnosticRef.current = "";
      setEstimatedTokens(null);

      setStatus({
        kind: "working",
        message:
          "Loading the live curve and calculating the purchase...",
      });

      const mintA = new PublicKey(normalizedMint);

      const poolId = getPdaLaunchpadPoolId(
        KODIAK_LAUNCHPAD_PROGRAM_ID,
        mintA,
        NATIVE_MINT,
      ).publicKey;

      const raydium = await loadKodiakRaydium({
        connection,
        owner: publicKey,
        signTransaction,
        signAllTransactions,
      });

      const kodiakPlatformId =
        await getKodiakPlatformId();

      const mintInfo =
        await raydium.token.getTokenInfo(
          mintA,
        );

      const buildBondingBuy =
        async () => {
          const poolInfo =
            await raydium.launchpad.getRpcPoolInfo({
              poolId,
            });

          assertKodiakLaunchpadPool(
            poolInfo.platformId,
            kodiakPlatformId,
          );

          const platformAccount =
            await connection.getAccountInfo(
              poolInfo.platformId,
              "confirmed",
            );

          if (!platformAccount) {
            throw new Error(
              `The LaunchLab PlatformConfig account was not found on ${NETWORK_LABEL}.`,
            );
          }

          const platformInfo =
            PlatformConfig.decode(
              platformAccount.data,
            );

          return raydium.launchpad.buyToken({
            programId:
              KODIAK_LAUNCHPAD_PROGRAM_ID,
            mintA,
            mintAProgram:
              new PublicKey(
                mintInfo.programId,
              ),
            poolInfo,
            slippage:
              TRADE_SLIPPAGE,
            configInfo:
              poolInfo.configInfo,
            platformFeeRate:
              platformInfo.feeRate,
            txVersion:
              TxVersion.V0,
            buyAmount:
              new BN(
                lamports,
              ),

            /*
             * Phantom compatibility:
             *
             * Raydium's normal SOL-buy path creates a temporary wrapped-SOL
             * account backed by an ephemeral Keypair. That makes the
             * transaction require more than one signer, which is the exact
             * condition Phantom warns can prevent reliable transaction
             * simulation.
             *
             * fromCreate=true tells Raydium to use the wallet's associated
             * wrapped-SOL account instead. The SDK creates it idempotently,
             * transfers the exact SOL input into it, and syncs native SOL.
             * That removes the temporary Keypair signer from the buy.
             */
            fromCreate:
              true,
            feePayer:
              publicKey,
          });
        };

      const simulationBuild =
        await buildBondingBuy();

      setEstimatedTokens(
        simulationBuild.extInfo.decimalOutAmount.toString(),
      );
      setPoolIdText(
        poolId.toBase58(),
      );

      setStatus({
        kind: "working",
        message:
          "Simulating the buy before the wallet can sign...",
      });

      const simulation =
        simulationBuild.transaction instanceof
        VersionedTransaction
          ? await connection.simulateTransaction(
              simulationBuild.transaction,
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
              simulationBuild.transaction,
            );

      if (simulation.value.err) {
        setStatus({
          kind: "error",
          message: "Kodiak's safety simulation found a problem, so the wallet transaction was not sent.",
          action: "Do not keep retrying blindly. If this repeats, send Kodiak support the support code and program logs below.",
          code: "SIMULATION_FAILED",
          technical: `Buy simulation failed: ${JSON.stringify(simulation.value.err)}`,
          logs: simulation.value.logs ?? [],
        });
        return;
      }

      const postSimulationGraduation =
        await loadGraduationState(
          normalizedMint,
          {
            silent:
              true,
          },
        );

      if (
        !postSimulationGraduation ||
        !postSimulationGraduation.trading.launchpadActive ||
        postSimulationGraduation.trading.graduationReady ||
        postSimulationGraduation.trading.graduated ||
        postSimulationGraduation.trading.cancelled
      ) {
        throw new Error(
          "This token's LaunchLab state changed after simulation. No wallet request was opened; refresh and try again.",
        );
      }

      setStatus({
        kind: "working",
        message:
          "Simulation passed. Reloading the live curve and rebuilding the buy before wallet approval...",
      });

      const freshBuild =
        await buildBondingBuy();

      setEstimatedTokens(
        freshBuild.extInfo.decimalOutAmount.toString(),
      );

      setStatus({
        kind: "working",
        message:
          `Fresh curve quote built after simulation. Approve the ${NETWORK_LABEL} buy in your wallet...`,
      });

      if (!(freshBuild.transaction instanceof VersionedTransaction)) {
        throw new Error(
          "Kodiak expected a versioned bonding-curve buy transaction before wallet approval.",
        );
      }

      /*
       * A bonding-curve SOL buy must now be wallet-only signing.
       * If Raydium ever changes its builder and reintroduces an ephemeral
       * signer, stop here instead of sending Phantom a transaction it cannot
       * reliably preview.
       */
      if (freshBuild.signers.length !== 0) {
        throw new Error(
          `Kodiak stopped the buy before wallet handoff because Raydium returned ${freshBuild.signers.length} additional signer(s). No transaction was sent to Phantom.`,
        );
      }

      await diagnoseWalletTransaction(
        freshBuild.transaction,
        "Bonding-curve buy diagnostic",
      );

      const signature =
        await sendFreshWalletTransaction(
          freshBuild.transaction,
        );

      if (!signature) {
        throw new Error(
          "The purchase succeeded, but no transaction signature was returned.",
        );
      }

      setStatus({
        kind: "working",
        message:
          "Purchase confirmed. Updating the token chart...",
      });

      const recorded = await recordTrade({
        mint: mintA,
        signature,
        side: "buy",
        solAmount: Number(buySol),
      });

      setStatus({
        kind: "success",
        message: recorded
          ? `${buySol} ${NETWORK_LABEL} SOL purchase confirmed and added to the chart.`
          : `${buySol} ${NETWORK_LABEL} SOL purchase confirmed. Chart indexing is still pending.`,
        signature,
      });
    } catch (error) {
      const failure = classifyKodiakFailure(
        error,
        `The ${NETWORK_LABEL} purchase failed.`,
      );
      const technical = transactionDiagnosticRef.current
        ? `${failure.technical} | ${transactionDiagnosticRef.current}`
        : failure.technical;

      setStatus({
        kind: "error",
        message: failure.message,
        action: failure.action,
        code: failure.code,
        technical,
        logs: extractLogs(error),
      });
    }
  };

  const sellToken = async () => {
    if (
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

    if (!mintIsValid) {
      setStatus({
        kind: "error",
        message:
          `Enter or load a valid ${NETWORK_LABEL} mint first.`,
      });
      return;
    }

    let liveGraduation:
      GraduationState | null =
      null;

    try {
      liveGraduation =
        await loadGraduationState(
          normalizedMint,
          {
            silent:
              true,
          },
        );

      if (
        liveGraduation?.trading.graduationReady
      ) {
        setStatus({
          kind: "error",
          message:
            "This token has reached its bonding target. Trading is paused while graduation completes.",
        });
        return;
      }

      if (
        liveGraduation?.trading.cancelled
      ) {
        setStatus({
          kind: "error",
          message:
            "This LaunchLab pool is cancelled.",
        });
        return;
      }

      if (
        liveGraduation?.trading.graduated &&
        !liveGraduation.trading.cpmmReady
      ) {
        setStatus({
          kind: "error",
          message:
            "This token has graduated and Kodiak is waiting for its Raydium CPMM pool.",
        });
        return;
      }
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Kodiak could not verify the token's graduation state.",
      });
      return;
    }

    if (
      tokenDecimals === null ||
      tokenBalance === null
    ) {
      setStatus({
        kind: "error",
        message:
          "Kodiak could not read this wallet's token balance yet.",
      });
      return;
    }

    const sellNumber = Number(sellTokens);

    if (
      !Number.isFinite(sellNumber) ||
      sellNumber <= 0
    ) {
      setStatus({
        kind: "error",
        message:
          "Enter a token amount greater than 0.",
      });
      return;
    }

    if (sellNumber > tokenBalance) {
      setStatus({
        kind: "error",
        message:
          "The sell amount is greater than this wallet's token balance.",
      });
      return;
    }

    let rawSellAmount: BN;

    try {
      rawSellAmount = decimalToRawAmount(
        sellTokens,
        tokenDecimals,
      );
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The token amount is invalid.",
      });
      return;
    }

    if (rawSellAmount.lte(new BN(0))) {
      setStatus({
        kind: "error",
        message:
          "The token amount is too small to sell.",
      });
      return;
    }

    if (
      liveGraduation?.trading.graduated &&
      liveGraduation.trading.cpmmReady
    ) {
      try {
        await executeCpmmSell({
          graduation:
            liveGraduation,
          rawSellAmount,
          sellNumber,
        });
      } catch (error) {
        const failure = classifyKodiakFailure(
          error,
          `The ${NETWORK_LABEL} CPMM sale failed.`,
        );
        setStatus({
          kind: "error",
          message: failure.message,
          action: failure.action,
          code: failure.code,
          technical: failure.technical,
          logs: extractLogs(error),
        });
      }

      return;
    }

    try {
      setEstimatedSellSol(null);

      setStatus({
        kind: "working",
        message:
          "Loading the live curve and calculating the sale...",
      });

      const mintA = new PublicKey(normalizedMint);

      const poolId = getPdaLaunchpadPoolId(
        KODIAK_LAUNCHPAD_PROGRAM_ID,
        mintA,
        NATIVE_MINT,
      ).publicKey;

      const raydium = await loadKodiakRaydium({
        connection,
        owner: publicKey,
        signTransaction,
        signAllTransactions,
      });

      const kodiakPlatformId =
        await getKodiakPlatformId();

      const mintInfo =
        await raydium.token.getTokenInfo(
          mintA,
        );

      /*
       * IMPORTANT:
       * Do not pass minAmountB: new BN(0).
       *
       * Raydium LaunchLab rejects a zero minimum WSOL
       * output. By omitting minAmountB and supplying
       * slippage, the SDK calculates the expected SOL
       * output from the current bonding curve and applies
       * the 1% slippage protection itself.
       */
      const buildBondingSell =
        async () => {
          const poolInfo =
            await raydium.launchpad.getRpcPoolInfo({
              poolId,
            });

          assertKodiakLaunchpadPool(
            poolInfo.platformId,
            kodiakPlatformId,
          );

          const platformAccount =
            await connection.getAccountInfo(
              poolInfo.platformId,
              "confirmed",
            );

          if (!platformAccount) {
            throw new Error(
              `The LaunchLab PlatformConfig account was not found on ${NETWORK_LABEL}.`,
            );
          }

          const platformInfo =
            PlatformConfig.decode(
              platformAccount.data,
            );

          return raydium.launchpad.sellToken({
            programId:
              KODIAK_LAUNCHPAD_PROGRAM_ID,
            mintA,
            mintAProgram:
              new PublicKey(
                mintInfo.programId,
              ),
            mintB:
              NATIVE_MINT,
            poolInfo,
            configInfo:
              poolInfo.configInfo,
            platformFeeRate:
              platformInfo.feeRate,
            txVersion:
              TxVersion.V0,
            feePayer:
              publicKey,
            sellAmount:
              rawSellAmount,
            slippage:
              TRADE_SLIPPAGE,
          });
        };

      const simulationBuild =
        await buildBondingSell();

      let estimatedLamports =
        Number(
          simulationBuild.extInfo.outAmount.toString(),
        );

      if (
        Number.isFinite(
          estimatedLamports,
        )
      ) {
        setEstimatedSellSol(
          (
            estimatedLamports /
            LAMPORTS_PER_SOL
          ).toFixed(
            9,
          ),
        );
      }

      setPoolIdText(
        poolId.toBase58(),
      );

      setStatus({
        kind: "working",
        message:
          "Simulating the sell before the wallet can sign...",
      });

      const simulation =
        simulationBuild.transaction instanceof
        VersionedTransaction
          ? await connection.simulateTransaction(
              simulationBuild.transaction,
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
              simulationBuild.transaction,
            );

      if (simulation.value.err) {
        setStatus({
          kind: "error",
          message: "Kodiak's safety simulation found a problem, so the wallet transaction was not sent.",
          action: "Do not keep retrying blindly. If this repeats, send Kodiak support the support code and program logs below.",
          code: "SIMULATION_FAILED",
          technical: `Sell simulation failed: ${JSON.stringify(simulation.value.err)}`,
          logs: simulation.value.logs ?? [],
        });
        return;
      }

      const postSimulationGraduation =
        await loadGraduationState(
          normalizedMint,
          {
            silent:
              true,
          },
        );

      if (
        !postSimulationGraduation ||
        !postSimulationGraduation.trading.launchpadActive ||
        postSimulationGraduation.trading.graduationReady ||
        postSimulationGraduation.trading.graduated ||
        postSimulationGraduation.trading.cancelled
      ) {
        throw new Error(
          "This token's LaunchLab state changed after simulation. No wallet request was opened; refresh and try again.",
        );
      }

      setStatus({
        kind: "working",
        message:
          "Simulation passed. Reloading the live curve and rebuilding the sell before wallet approval...",
      });

      const freshBuild =
        await buildBondingSell();

      estimatedLamports =
        Number(
          freshBuild.extInfo.outAmount.toString(),
        );

      if (
        Number.isFinite(
          estimatedLamports,
        )
      ) {
        setEstimatedSellSol(
          (
            estimatedLamports /
            LAMPORTS_PER_SOL
          ).toFixed(
            9,
          ),
        );
      }

      setStatus({
        kind: "working",
        message:
          `Fresh curve quote built after simulation. Approve the ${NETWORK_LABEL} sell in your wallet...`,
      });

      if (!(freshBuild.transaction instanceof VersionedTransaction)) {
        throw new Error(
          "Kodiak expected a versioned bonding-curve sell transaction before wallet approval.",
        );
      }

      const signature =
        await sendFreshWalletTransaction(
          freshBuild.transaction,
        );

      if (!signature) {
        throw new Error(
          "The sale succeeded, but no transaction signature was returned.",
        );
      }

      setStatus({
        kind: "working",
        message:
          "Sale confirmed. Updating the token chart...",
      });

      const solAmount = Number.isFinite(
        estimatedLamports,
      )
        ? estimatedLamports / LAMPORTS_PER_SOL
        : undefined;

      const recorded = await recordTrade({
        mint: mintA,
        signature,
        side: "sell",
        solAmount,
        tokenAmount: sellNumber,
      });

      setSellTokens("");

      setStatus({
        kind: "success",
        message: recorded
          ? `${sellNumber.toLocaleString()} tokens sold and added to the chart.`
          : `${sellNumber.toLocaleString()} tokens sold. Chart indexing is still pending.`,
        signature,
      });
    } catch (error) {
      const failure = classifyKodiakFailure(
        error,
        `The ${NETWORK_LABEL} sale failed.`,
      );
      setStatus({
        kind: "error",
        message: failure.message,
        action: failure.action,
        code: failure.code,
        technical: failure.technical,
        logs: extractLogs(error),
      });
    }
  };

  function setSellPercent(percent: number) {
    if (
      tokenBalance === null ||
      tokenBalance <= 0
    ) {
      setSellTokens("");
      return;
    }

    setSellTokens(
      (tokenBalance * percent)
        .toFixed(6)
        .replace(/\.?0+$/, ""),
    );
  }

  const symbolLabel = tokenSymbol
    ? tokenSymbol.startsWith("$")
      ? tokenSymbol
      : `$${tokenSymbol}`
    : "TOKEN";

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="rounded-3xl border border-emerald-400/20 bg-white/[0.03] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.24em] text-emerald-300">
                Kodiak {NETWORK_LABEL}
              </p>
              <h1 className="mt-2 text-4xl font-black">
                Kodiak Trade
              </h1>
              <p className="mt-3 max-w-xl text-zinc-400">
                Trade through Kodiak on {NETWORK_LABEL}. LaunchLab is used before graduation and Raydium CPMM after graduation.
              </p>
            </div>

            <KodiakWalletButton />
          </div>
        </header>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <button
            type="button"
            onClick={loadLastLaunch}
            className="mb-5 w-full rounded-2xl border border-amber-300/30 px-5 py-4 font-black text-amber-300"
          >
            Load Last Kodiak Launch
          </button>

          <label className="block">
            <span className="mb-2 block text-sm font-bold text-zinc-300">
              Token mint
            </span>

            <input
              value={mintText}
              onChange={(event) => {
                setMintText(event.target.value);
                setPoolIdText("");
                setEstimatedTokens(null);
                setEstimatedSellSol(null);
                setSellTokens("");
                setGraduationState(null);
              }}
              placeholder={`Paste a ${NETWORK_LABEL} LaunchLab mint`}
              className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-4 font-mono text-sm outline-none focus:border-emerald-400/50"
            />
          </label>

          {(tokenName || tokenSymbol) && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
              <p className="font-black">
                {tokenName || "Kodiak launch"}
                {tokenSymbol
                  ? ` - ${symbolLabel}`
                  : ""}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => void loadPool()}
            disabled={
              status.kind === "working" ||
              graduationLoading ||
              !connected ||
              !mintIsValid
            }
            className="mt-5 w-full rounded-2xl border border-emerald-400/30 px-5 py-4 font-black text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Refresh {NETWORK_LABEL} Trading State
          </button>
        </section>

        {graduationState && (
          <section
            className={`rounded-3xl border p-6 ${
              graduationState.trading.graduated
                ? "border-amber-300/30 bg-amber-300/[0.06]"
                : graduationState.trading.graduationReady
                  ? "border-amber-300/30 bg-amber-300/[0.06]"
                  : graduationState.trading.cancelled
                    ? "border-red-400/25 bg-red-400/[0.06]"
                    : "border-emerald-400/20 bg-emerald-400/[0.04]"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-zinc-500">
                  Trading lifecycle
                </p>

                <h2 className="mt-2 text-2xl font-black">
                  {graduationState.trading.graduated
                    ? "Graduated to Raydium CPMM"
                    : graduationState.trading.graduationReady
                      ? "Graduation ready"
                      : graduationState.trading.cancelled
                        ? "Launch cancelled"
                        : "LaunchLab bonding curve"}
                </h2>
              </div>

              <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs font-black uppercase">
                {graduationState.state}
              </span>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-zinc-500">
                  Bonding progress
                </span>

                <span className="font-black">
                  {Math.min(
                    100,
                    graduationState.bonding.progressPercent,
                  ).toFixed(2)}
                  %
                </span>
              </div>

              <div className="mt-2 h-3 overflow-hidden rounded-full bg-white/[0.07]">
                <div
                  className="h-full bg-emerald-400"
                  style={{
                    width: `${Math.min(
                      100,
                      graduationState.bonding.progressPercent,
                    )}%`,
                  }}
                />
              </div>
            </div>

            {graduationState.cpmmPoolId && (
              <div className="mt-5 rounded-2xl border border-amber-300/20 bg-black/25 p-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-300">
                  Raydium CPMM pool
                </p>

                <p className="mt-2 break-all font-mono text-xs">
                  {graduationState.cpmmPoolId}
                </p>

                <a
                  href={kodiakExplorerAddressUrl(
                    graduationState.cpmmPoolId,
                  )}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-block text-sm font-black text-amber-300"
                >
                  View CPMM pool
                </a>
              </div>
            )}

            {graduationState.trading.graduated &&
              !graduationState.trading.cpmmReady && (
                <p className="mt-4 text-sm leading-6 text-amber-200">
                  Graduation is confirmed on-chain. Kodiak is waiting for the CPMM pool account to be discoverable before enabling post-graduation trading.
                </p>
              )}

            {graduationState.trading.graduationReady && (
              <p className="mt-4 text-sm leading-6 text-amber-200">
                The bonding target has been reached. Kodiak has disabled curve trading so no new LaunchLab order is prepared during the graduation transition.
              </p>
            )}
          </section>
        )}

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <div className="mb-5 grid grid-cols-2 rounded-2xl border border-white/10 bg-black/30 p-1">
            <button
              type="button"
              onClick={() => setTradeMode("buy")}
              className={`rounded-xl px-4 py-3 text-sm font-black ${
                tradeMode === "buy"
                  ? "bg-emerald-400 text-black"
                  : "text-zinc-400"
              }`}
            >
              Buy
            </button>

            <button
              type="button"
              onClick={() => setTradeMode("sell")}
              className={`rounded-xl px-4 py-3 text-sm font-black ${
                tradeMode === "sell"
                  ? "bg-rose-400 text-black"
                  : "text-zinc-400"
              }`}
            >
              Sell
            </button>
          </div>

          {tradeMode === "buy" ? (
            <>
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-2xl font-black">
                  Buy with {NETWORK_LABEL} SOL
                </h2>

                <p className="text-sm text-zinc-400">
                  Wallet:{" "}
                  {publicKey
                    ? walletSol ?? "Loading..."
                    : "-"}{" "}
                  SOL
                </p>
              </div>

              <input
                inputMode="decimal"
                value={buySol}
                onChange={(event) =>
                  setBuySol(event.target.value)
                }
                className="mt-5 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-4 text-2xl font-black outline-none focus:border-emerald-400/50"
              />

              <div className="mt-3 grid grid-cols-4 gap-2">
                {[
                  "0.001",
                  "0.01",
                  "0.05",
                  "0.1",
                ].map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() =>
                      setBuySol(amount)
                    }
                    className="rounded-xl border border-white/10 bg-black/30 px-2 py-3 text-sm font-bold"
                  >
                    {amount}
                  </button>
                ))}
              </div>

              <p className="mt-4 text-xs leading-5 text-zinc-500">
                Slippage is fixed at 1%.
              </p>

              <button
                type="button"
                onClick={() => void buyToken()}
                disabled={
                  status.kind === "working" ||
                  !connected ||
                  !mintIsValid ||
                  Boolean(
                    graduationState &&
                      !graduationState.trading.launchpadActive &&
                      !graduationState.trading.cpmmReady,
                  )
                }
                className="mt-5 w-full rounded-2xl bg-gradient-to-r from-emerald-400 to-amber-300 px-6 py-4 text-lg font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
              >
                {status.kind === "working"
                  ? `Preparing ${NETWORK_LABEL} buy...`
                  : graduationState?.trading.graduated
                    ? "Buy on Raydium CPMM"
                    : graduationState?.trading.graduationReady
                      ? "Graduation in Progress"
                      : "Buy on Bonding Curve"}
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-black">
                    Sell {symbolLabel}
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    Sell tokens back into the Raydium
                    LaunchLab bonding curve.
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-xs text-zinc-500">
                    Token balance
                  </p>
                  <p className="text-sm font-black text-emerald-300">
                    {publicKey
                      ? tokenBalance === null
                        ? "Loading..."
                        : tokenBalance.toLocaleString(
                            undefined,
                            {
                              maximumFractionDigits: 6,
                            },
                          )
                      : "-"}
                  </p>
                </div>
              </div>

              <input
                inputMode="decimal"
                value={sellTokens}
                onChange={(event) =>
                  setSellTokens(event.target.value)
                }
                placeholder="0"
                className="mt-5 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-4 text-2xl font-black outline-none focus:border-rose-400/50"
              />

              <div className="mt-3 grid grid-cols-4 gap-2">
                {[
                  ["25%", 0.25],
                  ["50%", 0.5],
                  ["75%", 0.75],
                  ["MAX", 1],
                ].map(([label, percent]) => (
                  <button
                    key={String(label)}
                    type="button"
                    onClick={() =>
                      setSellPercent(
                        Number(percent),
                      )
                    }
                    disabled={
                      tokenBalance === null ||
                      tokenBalance <= 0
                    }
                    className="rounded-xl border border-white/10 bg-black/30 px-2 py-3 text-sm font-bold disabled:opacity-40"
                  >
                    {String(label)}
                  </button>
                ))}
              </div>

              <p className="mt-4 text-xs leading-5 text-zinc-500">
                Slippage is fixed at 1%. Raydium
                calculates the minimum SOL output from
                the live curve before building the
                transaction.
              </p>

              <button
                type="button"
                onClick={() => void sellToken()}
                disabled={
                  status.kind === "working" ||
                  !connected ||
                  !mintIsValid ||
                  Boolean(
                    graduationState &&
                      !graduationState.trading.launchpadActive &&
                      !graduationState.trading.cpmmReady,
                  ) ||
                  !sellTokens ||
                  tokenBalance === null ||
                  tokenBalance <= 0
                }
                className="mt-5 w-full rounded-2xl bg-rose-400 px-6 py-4 text-lg font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
              >
                {status.kind === "working"
                  ? `Preparing ${NETWORK_LABEL} sell...`
                  : graduationState?.trading.graduated
                    ? "Sell on Raydium CPMM"
                    : graduationState?.trading.graduationReady
                      ? "Graduation in Progress"
                      : "Sell on Bonding Curve"}
              </button>
            </>
          )}
        </section>

        {poolIdText && (
          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-sm">
            <h2 className="text-xl font-black">
              Live quote
            </h2>

            {tradeMode === "buy" &&
              estimatedTokens && (
                <div className="mt-4">
                  <p className="text-zinc-500">
                    Estimated token output
                  </p>
                  <p className="mt-1 break-all text-2xl font-black text-emerald-300">
                    {estimatedTokens}
                  </p>
                </div>
              )}

            {tradeMode === "sell" &&
              estimatedSellSol && (
                <div className="mt-4">
                  <p className="text-zinc-500">
                    Estimated SOL output
                  </p>
                  <p className="mt-1 break-all text-2xl font-black text-rose-300">
                    {estimatedSellSol} SOL
                  </p>
                </div>
              )}

            <div className="mt-5">
              <p className="text-zinc-500">
                LaunchLab pool
              </p>
              <p className="mt-1 break-all font-mono text-xs">
                {poolIdText}
              </p>
              <a
                href={kodiakExplorerAddressUrl(poolIdText)}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block font-black text-amber-300"
              >
                View pool on Solana Explorer
              </a>
            </div>
          </section>
        )}

        <section
          className={`rounded-3xl border p-5 text-sm ${
            status.kind === "error"
              ? "border-red-400/25 bg-red-400/[0.06] text-red-100"
              : status.kind === "success"
                ? "border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-100"
                : "border-white/10 bg-white/[0.03] text-zinc-400"
          }`}
        >
          <p className="font-black">
            {status.message}
          </p>

          {status.kind === "success" &&
            status.signature && (
              <a
                href={kodiakExplorerTransactionUrl(
                  status.signature,
                )}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block font-black text-amber-300"
              >
                View transaction
              </a>
            )}

          {status.kind === "error" && status.action && (
            <div className="mt-3 rounded-2xl border border-red-300/15 bg-black/25 p-4">
              <p className="text-xs font-black uppercase tracking-[0.12em] text-red-200">What to do</p>
              <p className="mt-2 text-xs leading-5 text-zinc-300">{status.action}</p>
              {status.code && (
                <p className="mt-3 font-mono text-[11px] text-zinc-500">Support code: {status.code}</p>
              )}
              {status.technical && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-bold text-zinc-400">Technical details</summary>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-5 text-zinc-500">{status.technical}</pre>
                </details>
              )}
            </div>
          )}

          {status.kind === "error" &&
            status.logs &&
            status.logs.length > 0 && (
              <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-black/50 p-4 text-[11px] leading-5 text-zinc-300">
                {status.logs.join("\n")}
              </pre>
            )}
        </section>

        <div className="pb-8">
          <a
            href="/launch"
            className="inline-block rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-zinc-300"
          >
            Back to Launch
          </a>
        </div>
      </div>
    </main>
  );
}
