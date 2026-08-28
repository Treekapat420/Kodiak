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
  Transaction,
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
  KODIAK_IS_MAINNET,
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

type CpmmCreatorFeeEntry = {
  id: string;
  fee: {
    amountA: string;
    amountB: string;
  };
  poolInfo: {
    id: string;
    programId: string;
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
  } & Record<string, unknown>;
};

type CpmmCreatorFeeResponse = {
  id?: string;
  success?: boolean;
  data?: CpmmCreatorFeeEntry[];
};

type KodiakLaunchRecord = {
  mint: string;
  name: string;
  symbol: string;
};

type KodiakGraduationResponse = {
  mint?: string;
  state?: string;
  cpmmPoolId?: string | null;
  trading?: {
    graduated?: boolean;
    cpmmReady?: boolean;
  };
  error?: string;
};

type KnownCpmmPool = {
  mint: string;
  name: string;
  symbol: string;
  poolId: string;
  creatorMatches?: boolean;
  feeA?: string;
  feeB?: string;
  feeARaw?: string;
  feeBRaw?: string;
  mintA?: string;
  mintB?: string;
  symbolA?: string;
  symbolB?: string;
};

function readU64LE(data: Buffer, offset: number): bigint {
  return data.readBigUInt64LE(offset);
}

function formatRawAmount(raw: bigint, decimals: number): string {
  const negative = raw < BigInt(0);
  const value = negative ? -raw : raw;
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}

function friendlyMintSymbol(address: string, fallback?: string): string {
  if (address === NATIVE_MINT.toBase58()) return "SOL";
  return fallback || `${address.slice(0, 4)}...${address.slice(-4)}`;
}

const NETWORK_LABEL = kodiakNetworkLabel();

/*
 * Canonical Raydium Mainnet program IDs.
 *
 * Keep these as a safety assertion around the SDK-built transaction. The
 * Raydium SDK uses Mainnet defaults automatically, while Devnet requires the
 * explicit DEVNET_PROGRAM_ID overrides below.
 */
const MAINNET_CPMM_PROGRAM_ID =
  new PublicKey(
    "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
  );

const MAINNET_LOCK_CPMM_PROGRAM_ID =
  new PublicKey(
    "LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE",
  );

function expectedCpmmProgramId() {
  return KODIAK_IS_DEVNET
    ? DEVNET_PROGRAM_ID
        .CREATE_CPMM_POOL_PROGRAM
    : MAINNET_CPMM_PROGRAM_ID;
}

function expectedLockProgramId() {
  return KODIAK_IS_DEVNET
    ? DEVNET_PROGRAM_ID
        .LOCK_CPMM_PROGRAM
    : MAINNET_LOCK_CPMM_PROGRAM_ID;
}

function assertCorrectCpmmPoolProgram(
  programId: string,
) {
  const actual =
    new PublicKey(
      programId,
    );

  const expected =
    expectedCpmmProgramId();

  if (!actual.equals(expected)) {
    throw new Error(
      `Refusing Fee Key claim: the CPMM pool belongs to ${actual.toBase58()}, but Kodiak expects ${expected.toBase58()} on ${NETWORK_LABEL}.`,
    );
  }
}

function assertCorrectLockProgram(
  transaction: VersionedTransaction,
) {
  const expected =
    expectedLockProgramId();

  const includesExpectedProgram =
    transaction.message.staticAccountKeys.some(
      (key) =>
        key.equals(
          expected,
        ),
    );

  if (!includesExpectedProgram) {
    throw new Error(
      `Refusing Fee Key claim: the Raydium transaction does not include the expected ${NETWORK_LABEL} Burn & Earn / LP Lock program ${expected.toBase58()}.`,
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

function formatRawTokenAmount(
  raw: string,
  decimals: number,
) {
  const normalized =
    raw.trim().replace(
      /^\+/,
      "",
    );

  if (!/^\d+$/.test(normalized)) {
    return "0";
  }

  const padded =
    normalized.padStart(
      decimals + 1,
      "0",
    );

  const whole =
    decimals === 0
      ? padded
      : padded.slice(
          0,
          -decimals,
        );

  const fraction =
    decimals === 0
      ? ""
      : padded
          .slice(-decimals)
          .replace(
            /0+$/,
            "",
          );

  return fraction
    ? `${whole}.${fraction}`
    : whole;
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

  type WalletTransaction =
    Transaction | VersionedTransaction;

  const raydiumSignTransaction = async <
    T extends WalletTransaction,
  >(transaction: T): Promise<T> => {
    if (!signTransaction) {
      throw new Error(
        `Connect a wallet on ${NETWORK_LABEL} first.`,
      );
    }

    const signed = await signTransaction(
      transaction,
    );

    if (!signed) {
      throw new Error(
        "Wallet did not return a signed transaction.",
      );
    }

    return signed as T;
  };

  const raydiumSignAllTransactions = async <
    T extends WalletTransaction,
  >(transactions: T[]): Promise<T[]> => {
    if (!signAllTransactions) {
      throw new Error(
        `Connect a wallet on ${NETWORK_LABEL} first.`,
      );
    }

    const signed = await signAllTransactions(
      transactions,
    );

    if (!signed) {
      throw new Error(
        "Wallet did not return signed transactions.",
      );
    }

    return signed as T[];
  };

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
    cpmmCreatorFees,
    setCpmmCreatorFees,
  ] =
    useState<CpmmCreatorFeeEntry[]>(
      [],
    );

  const [
    cpmmCreatorFeesLoading,
    setCpmmCreatorFeesLoading,
  ] =
    useState(false);

  const [
    claimingCpmmPool,
    setClaimingCpmmPool,
  ] =
    useState<string | null>(
      null,
    );

  const [
    knownCpmmPools,
    setKnownCpmmPools,
  ] =
    useState<KnownCpmmPool[]>(
      [],
    );

  const [
    knownCpmmPoolsLoading,
    setKnownCpmmPoolsLoading,
  ] =
    useState(false);

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
          signTransaction: raydiumSignTransaction,
          signAllTransactions: raydiumSignAllTransactions,
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

  async function discoverKnownCpmmPools() {
    if (!publicKey) {
      setKnownCpmmPools([]);
      return [];
    }

    try {
      setKnownCpmmPoolsLoading(true);

      const launchesResponse =
        await fetch(
          `/api/creator/launches?creator=${encodeURIComponent(
            publicKey.toBase58(),
          )}`,
          {
            cache: "no-store",
          },
        );

      const launchesPayload =
        (await launchesResponse.json()) as {
          launches?: KodiakLaunchRecord[];
          error?: string;
        };

      if (!launchesResponse.ok) {
        throw new Error(
          launchesPayload.error ||
            "Unable to load this creator's Kodiak launches.",
        );
      }

      const launches =
        Array.isArray(
          launchesPayload.launches,
        )
          ? launchesPayload.launches
          : [];

      const results =
        await Promise.all(
          launches.map(
            async (
              launch,
            ): Promise<KnownCpmmPool | null> => {
              try {
                const response =
                  await fetch(
                    `/api/token/${encodeURIComponent(
                      launch.mint,
                    )}/graduation`,
                    {
                      cache: "no-store",
                    },
                  );

                const payload =
                  (await response.json()) as
                    KodiakGraduationResponse;

                if (
                  !response.ok ||
                  !payload.trading
                    ?.graduated ||
                  !payload.trading
                    ?.cpmmReady ||
                  !payload.cpmmPoolId
                ) {
                  return null;
                }

                const poolId = payload.cpmmPoolId;
                const accountInfo =
                  await connection.getAccountInfo(
                    new PublicKey(poolId),
                    "confirmed",
                  );

                if (!accountInfo || accountInfo.data.length < 413) {
                  return {
                    mint: launch.mint,
                    name: launch.name,
                    symbol: launch.symbol,
                    poolId,
                  };
                }

                // Raydium CPMM PoolState is #[repr(C, packed)]. The current
                // on-chain layout places pool_creator at byte 40 and the two
                // creator-fee u64 counters at bytes 397 and 405.
                const data = Buffer.from(accountInfo.data);
                const poolCreator = new PublicKey(
                  data.subarray(40, 72),
                );
                const creatorFee0 = readU64LE(data, 397);
                const creatorFee1 = readU64LE(data, 405);

                const raydium = await loadKodiakRaydium({
                  connection,
                  owner: publicKey,
                  signTransaction: raydiumSignTransaction,
                  signAllTransactions: raydiumSignAllTransactions,
                });
                const rpcPool =
                  await raydium.cpmm.getPoolInfoFromRpc(poolId);
                assertCorrectCpmmPoolProgram(rpcPool.poolInfo.programId);

                const mintA = rpcPool.poolInfo.mintA.address;
                const mintB = rpcPool.poolInfo.mintB.address;
                const decimalsA = rpcPool.poolInfo.mintA.decimals;
                const decimalsB = rpcPool.poolInfo.mintB.decimals;

                return {
                  mint: launch.mint,
                  name: launch.name,
                  symbol: launch.symbol,
                  poolId,
                  creatorMatches: poolCreator.equals(publicKey),
                  feeA: formatRawAmount(creatorFee0, decimalsA),
                  feeB: formatRawAmount(creatorFee1, decimalsB),
                  feeARaw: creatorFee0.toString(),
                  feeBRaw: creatorFee1.toString(),
                  mintA,
                  mintB,
                  symbolA: friendlyMintSymbol(
                    mintA,
                    rpcPool.poolInfo.mintA.symbol,
                  ),
                  symbolB: friendlyMintSymbol(
                    mintB,
                    rpcPool.poolInfo.mintB.symbol,
                  ),
                };
              } catch {
                return null;
              }
            },
          ),
        );

      const pools =
        results.filter(
          (
            item,
          ): item is KnownCpmmPool =>
            Boolean(item),
        );

      setKnownCpmmPools(
        pools,
      );

      return pools;
    } finally {
      setKnownCpmmPoolsLoading(
        false,
      );
    }
  }

  async function discoverCpmmCreatorFees() {
    if (!publicKey) {
      setCpmmCreatorFees([]);
      setKnownCpmmPools([]);
      return;
    }

    setStatus({
      kind: "working",
      message:
        `Checking ${NETWORK_LABEL} CPMM creator fees and Kodiak's graduated pools...`,
    });

    const pools =
      await discoverKnownCpmmPools();

    try {
      setCpmmCreatorFeesLoading(true);

      const response =
        await fetch(
          `/api/creator/cpmm-fees?wallet=${encodeURIComponent(
            publicKey.toBase58(),
          )}`,
          {
            cache: "no-store",
          },
        );

      const payload =
        (await response.json()) as
          CpmmCreatorFeeResponse & {
            error?: string;
          };

      if (!response.ok) {
        throw new Error(
          payload.error ||
            `Unable to load ${NETWORK_LABEL} CPMM creator fees.`,
        );
      }

      setCpmmCreatorFees(
        Array.isArray(payload.data)
          ? payload.data
          : [],
      );

      setStatus({
        kind: "idle",
        message: "",
      });
    } catch (error) {
      console.error(
        "Raydium CPMM creator-fee index unavailable; using Kodiak known-pool fallback:",
        error,
      );

      setCpmmCreatorFees([]);

      if (pools.length > 0) {
        setStatus({
          kind: "idle",
          message: "",
        });
      } else {
        setStatus({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unable to load Raydium CPMM creator fees.",
        });
      }
    } finally {
      setCpmmCreatorFeesLoading(false);
    }
  }


  async function claimCpmmCreatorFees(
    entry: CpmmCreatorFeeEntry,
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
          `Connect the creator wallet on ${NETWORK_LABEL} first.`,
      });
      return;
    }

    try {
      setClaimingCpmmPool(
        entry.poolInfo.id,
      );

      setStatus({
        kind: "working",
        message:
          `Loading the graduated Raydium CPMM pool on ${NETWORK_LABEL}...`,
      });

      const raydium =
        await loadKodiakRaydium({
          connection,
          owner:
            publicKey,
          signTransaction: raydiumSignTransaction,
          signAllTransactions: raydiumSignAllTransactions,
        });

      let poolInfo: unknown =
        entry.poolInfo;

      let poolKeys:
        | unknown
        | undefined;

      if (KODIAK_IS_DEVNET) {
        const rpcPool =
          await raydium.cpmm.getPoolInfoFromRpc(
            entry.poolInfo.id,
          );

        assertCorrectCpmmPoolProgram(
          rpcPool.poolInfo
            .programId,
        );

        poolInfo =
          rpcPool.poolInfo;

        poolKeys =
          rpcPool.poolKeys;
      } else {
        assertCorrectCpmmPoolProgram(
          entry.poolInfo
            .programId,
        );
      }

      const cpmm =
        raydium.cpmm as unknown as {
          collectCreatorFees: (
            params: {
              programId?:
                PublicKey;
              poolInfo:
                unknown;
              poolKeys?:
                unknown;
              txVersion:
                TxVersion;
            },
          ) => Promise<{
            transaction:
              unknown;
            signers?:
              unknown[];
          }>;
        };

      setStatus({
        kind: "working",
        message:
          "Building the Raydium CPMM creator-fee claim...",
      });

      const built =
        await cpmm.collectCreatorFees({
          programId:
            KODIAK_IS_DEVNET
              ? DEVNET_PROGRAM_ID
                  .CREATE_CPMM_POOL_PROGRAM
              : undefined,
          poolInfo,
          poolKeys,
          txVersion:
            TxVersion.V0,
        });

      if (
        !(
          built.transaction instanceof
          VersionedTransaction
        )
      ) {
        throw new Error(
          "Kodiak expected Raydium to build a versioned CPMM creator-fee transaction.",
        );
      }

      // Capture the narrowed value locally. TypeScript does not preserve
      // instanceof narrowing reliably through a mutable object property.
      const creatorFeeTransaction: VersionedTransaction =
        built.transaction;

      const extraSigners =
        Array.isArray(
          built.signers,
        )
          ? built.signers
          : [];

      if (
        extraSigners.length !==
        0
      ) {
        throw new Error(
          `Kodiak stopped the CPMM creator-fee claim because Raydium returned ${extraSigners.length} additional signer(s). No transaction was sent to the wallet.`,
        );
      }

      setStatus({
        kind: "working",
        message:
          `Simulating the ${NETWORK_LABEL} CPMM creator-fee claim before wallet approval...`,
      });

      const signature =
        await sendWalletFirstTransaction(
          creatorFeeTransaction,
        );

      await discoverCpmmCreatorFees();

      setStatus({
        kind: "success",
        message:
          `Raydium confirmed the post-graduation CPMM creator-fee claim on ${NETWORK_LABEL}.`,
        signature,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The CPMM creator-fee claim failed.",
      });
    } finally {
      setClaimingCpmmPool(
        null,
      );
    }
  }

  async function claimKnownCpmmPool(
    pool: KnownCpmmPool,
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
          `Connect the creator wallet on ${NETWORK_LABEL} first.`,
      });
      return;
    }

    try {
      setClaimingCpmmPool(
        pool.poolId,
      );

      setStatus({
        kind: "working",
        message:
          `Loading ${pool.symbol}'s graduated CPMM pool directly from ${NETWORK_LABEL} RPC...`,
      });

      const raydium =
        await loadKodiakRaydium({
          connection,
          owner:
            publicKey,
          signTransaction: raydiumSignTransaction,
          signAllTransactions: raydiumSignAllTransactions,
        });

      const rpcPool =
        await raydium.cpmm.getPoolInfoFromRpc(
          pool.poolId,
        );

      assertCorrectCpmmPoolProgram(
        rpcPool.poolInfo
          .programId,
      );

      const cpmm =
        raydium.cpmm as unknown as {
          collectCreatorFees: (
            params: {
              programId?:
                PublicKey;
              poolInfo:
                unknown;
              poolKeys?:
                unknown;
              txVersion:
                TxVersion;
            },
          ) => Promise<{
            transaction:
              unknown;
            signers?:
              unknown[];
          }>;
        };

      setStatus({
        kind: "working",
        message:
          `Building and simulating ${pool.symbol}'s CPMM creator-fee claim. Phantom will open only if simulation succeeds...`,
      });

      const built =
        await cpmm.collectCreatorFees({
          programId:
            KODIAK_IS_DEVNET
              ? DEVNET_PROGRAM_ID
                  .CREATE_CPMM_POOL_PROGRAM
              : undefined,
          poolInfo:
            rpcPool.poolInfo,
          poolKeys:
            rpcPool.poolKeys,
          txVersion:
            TxVersion.V0,
        });

      if (
        !(
          built.transaction instanceof
          VersionedTransaction
        )
      ) {
        throw new Error(
          "Kodiak expected Raydium to build a versioned CPMM creator-fee transaction.",
        );
      }

      // Capture the narrowed value locally. TypeScript does not preserve
      // instanceof narrowing reliably through a mutable object property.
      const creatorFeeTransaction: VersionedTransaction =
        built.transaction;

      const extraSigners =
        Array.isArray(
          built.signers,
        )
          ? built.signers
          : [];

      if (
        extraSigners.length !==
        0
      ) {
        throw new Error(
          `Kodiak stopped the CPMM creator-fee claim because Raydium returned ${extraSigners.length} additional signer(s). No transaction was sent to the wallet.`,
        );
      }

      const signature =
        await sendWalletFirstTransaction(
          creatorFeeTransaction,
        );

      setStatus({
        kind: "success",
        message:
          `Raydium confirmed ${pool.symbol}'s post-graduation CPMM creator-fee claim on ${NETWORK_LABEL}.`,
        signature,
      });

      await discoverCpmmCreatorFees();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The direct CPMM creator-fee claim failed.";

      if (message.includes('"Custom":6014') || message.includes("Custom: 6014")) {
        setStatus({
          kind: "idle",
          message:
            "Raydium reports that this CPMM pool currently has zero creator fees available to collect.",
        });
        await discoverCpmmCreatorFees();
      } else {
        setStatus({ kind: "error", message });
      }
    } finally {
      setClaimingCpmmPool(
        null,
      );
    }
  }


  useEffect(() => {
    const timer =
      window.setTimeout(
        () => {
          void refreshClaimableBalance();
          void discoverCpmmCreatorFees();
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

  async function sendWalletFirstTransaction(
    transaction: VersionedTransaction,
  ): Promise<string> {
    if (!signTransaction) {
      throw new Error(
        `Connect a wallet on ${NETWORK_LABEL} first.`,
      );
    }

    const latestBlockhash =
      await connection.getLatestBlockhash(
        "confirmed",
      );

    transaction.message.recentBlockhash =
      latestBlockhash.blockhash;

    transaction.signatures =
      transaction.signatures.map(
        () => new Uint8Array(64),
      );

    const simulation =
      await connection.simulateTransaction(
        transaction,
        {
          commitment: "confirmed",
          replaceRecentBlockhash: true,
          sigVerify: false,
        },
      );

    if (simulation.value.err) {
      throw new Error(
        `Claim simulation failed before wallet handoff: ${JSON.stringify(
          simulation.value.err,
        )}`,
      );
    }

    const walletSigned =
      await signTransaction(
        transaction,
      );

    const signature =
      await connection.sendRawTransaction(
        walletSigned.serialize(),
        {
          skipPreflight: false,
          maxRetries: 5,
        },
      );

    try {
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
          `The ${NETWORK_LABEL} claim was submitted but failed on-chain: ${JSON.stringify(
            confirmation.value.err,
          )}`,
        );
      }
    } catch (error) {
      // Mobile wallets/RPCs can time out after sendRawTransaction even when
      // Solana accepted the transaction. Check the signature directly before
      // reporting a failure to the creator.
      const statusResult =
        await connection.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        });
      const landed = statusResult.value[0];

      if (landed?.err) {
        throw new Error(
          `The ${NETWORK_LABEL} claim was submitted but failed on-chain: ${JSON.stringify(landed.err)}`,
        );
      }

      if (!landed) {
        throw new Error(
          `The claim was submitted as ${signature}, but ${NETWORK_LABEL} RPC timed out before Kodiak could verify it. Do not submit another claim until the on-chain fee balance refreshes.`,
        );
      }
    }

    return signature;
  }

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
          signTransaction: raydiumSignTransaction,
          signAllTransactions: raydiumSignAllTransactions,
        });

      const built =
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

      if (!(built.transaction instanceof VersionedTransaction)) {
        throw new Error(
          "Kodiak expected a versioned LaunchLab creator-fee claim transaction.",
        );
      }

      if (built.signers.length !== 0) {
        throw new Error(
          `Kodiak stopped the creator-fee claim because Raydium returned ${built.signers.length} additional signer(s). No transaction was sent to the wallet.`,
        );
      }

      setStatus({
        kind: "working",
        message:
          `Simulating the ${NETWORK_LABEL} LaunchLab creator-fee claim before wallet approval...`,
      });

      const signature =
        await sendWalletFirstTransaction(
          built.transaction,
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
          signTransaction: raydiumSignTransaction,
          signAllTransactions: raydiumSignAllTransactions,
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

      /*
       * Do not trust a stored/API pool ID by itself. Confirm that the pool
       * account belongs to the canonical CPMM program for Kodiak's active
       * network before building any claim transaction.
       */
      assertCorrectCpmmPoolProgram(
        poolInfo.programId,
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

      /*
       * Raydium's SDK uses its canonical production program IDs by default on
       * Mainnet. Devnet is the exception and requires explicit replacement
       * program/auth PDAs. After the SDK builds the V0 transaction, Kodiak
       * independently verifies that the expected cluster's LP Lock program is
       * actually present before simulation or wallet approval.
       */
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

      const built =
        await raydium.cpmm.harvestLockLp(
          params,
        );

      const {
        transaction,
      } = built;

      if (
        transaction instanceof
        VersionedTransaction
      ) {
        assertCorrectLockProgram(
          transaction,
        );
      } else if (
        KODIAK_IS_MAINNET
      ) {
        throw new Error(
          "Refusing Mainnet Fee Key claim because Kodiak could not verify the Raydium LP Lock program in the built transaction.",
        );
      }

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

      if (!(transaction instanceof VersionedTransaction)) {
        throw new Error(
          "Kodiak expected a versioned CPMM Fee Key claim transaction.",
        );
      }

      if (built.signers.length !== 0) {
        throw new Error(
          `Kodiak stopped the Fee Key claim because Raydium returned ${built.signers.length} additional signer(s). No transaction was sent to the wallet.`,
        );
      }

      setStatus({
        kind: "working",
        message:
          `Simulation passed. Opening the ${NETWORK_LABEL} CPMM Fee Key claim in your wallet...`,
      });

      const signature =
        await sendWalletFirstTransaction(
          transaction,
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
            Kodiak reads both Raydium creator reward phases: the LaunchLab creator vault before graduation and direct CPMM creator fees after graduation.
          </p>
        </div>

        <button
          type="button"
          disabled={
            !connected ||
            busy ||
            claimableSol === null ||
            claimableSol <= 0
          }
          onClick={() =>
            void claim()
          }
          className="shrink-0 rounded-xl bg-emerald-400 px-5 py-3 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy &&
          !claimingFeeKey
            ? "Claiming..."
            : claimableSol !== null && claimableSol <= 0
              ? "No Curve Rewards to Claim"
              : "Claim Curve Rewards"}
        </button>
      </div>

      <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-black/20 p-4">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">
          Pre-graduation - LaunchLab
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
              Post-graduation - CPMM
            </p>

            <h3 className="mt-2 text-lg font-black">
              Creator Fees
            </h3>
          </div>

          <button
            type="button"
            disabled={
              !connected ||
              cpmmCreatorFeesLoading ||
              knownCpmmPoolsLoading ||
              busy
            }
            onClick={() =>
              void discoverCpmmCreatorFees()
            }
            className="rounded-xl border border-amber-300/25 px-3 py-2 text-xs font-black text-amber-300 disabled:opacity-40"
          >
            {cpmmCreatorFeesLoading ||
            knownCpmmPoolsLoading
              ? "Refreshing..."
              : "Refresh CPMM Fees"}
          </button>
        </div>

        {!connected ? (
          <p className="mt-4 text-sm text-zinc-500">
            Connect the launch creator wallet to read its Raydium CPMM creator fees.
          </p>
        ) : cpmmCreatorFees.length > 0 ? (
          <div className="mt-4 grid gap-3">
            {cpmmCreatorFees.map(
              (
                entry,
              ) => {
                const {
                  poolInfo,
                  fee,
                } =
                  entry;

                const hasFees =
                  fee.amountA !==
                    "0" ||
                  fee.amountB !==
                    "0";

                return (
                  <div
                    key={
                      poolInfo.id
                    }
                    className="rounded-2xl border border-white/10 bg-black/25 p-4"
                  >
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
                      CPMM pool:{" "}
                      {
                        poolInfo.id
                      }
                    </p>

                    <div className="mt-3 grid gap-1 text-sm">
                      <p>
                        {tokenLabel(
                          poolInfo
                            .mintA
                            .symbol,
                          poolInfo
                            .mintA
                            .address,
                        )}{" "}
                        fees:{" "}
                        <span className="font-black text-amber-200">
                          {formatRawTokenAmount(
                            fee.amountA,
                            poolInfo
                              .mintA
                              .decimals,
                          )}
                        </span>
                      </p>

                      <p>
                        {tokenLabel(
                          poolInfo
                            .mintB
                            .symbol,
                          poolInfo
                            .mintB
                            .address,
                        )}{" "}
                        fees:{" "}
                        <span className="font-black text-amber-200">
                          {formatRawTokenAmount(
                            fee.amountB,
                            poolInfo
                              .mintB
                              .decimals,
                          )}
                        </span>
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={
                        busy ||
                        !hasFees
                      }
                      onClick={() =>
                        void claimCpmmCreatorFees(
                          entry,
                        )
                      }
                      className="mt-4 rounded-xl bg-amber-300 px-4 py-3 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {claimingCpmmPool ===
                      poolInfo.id
                        ? "Claiming..."
                        : hasFees
                          ? "Claim CPMM Fees"
                          : "No Fees Yet"}
                    </button>
                  </div>
                );
              },
            )}
          </div>
        ) : knownCpmmPools.length > 0 ? (
          <div className="mt-4">
            <div className="rounded-xl border border-amber-300/15 bg-black/20 p-3 text-sm leading-6 text-zinc-400">
              Raydium&apos;s creator-fee index did not return a balance. Kodiak found the graduated pool from its own verified launch records instead. The button below loads that exact pool from Solana RPC, builds Raydium&apos;s creator-fee claim, and simulates it before Phantom is opened.
            </div>

            <div className="mt-3 grid gap-3">
              {knownCpmmPools.map(
                (
                  pool,
                ) => (
                  <div
                    key={
                      pool.poolId
                    }
                    className="rounded-2xl border border-white/10 bg-black/25 p-4"
                  >
                    <p className="text-sm font-black">
                      {pool.name}{" "}
                      <span className="text-amber-200">
                        ${pool.symbol}
                      </span>
                    </p>

                    <p className="mt-1 break-all text-xs text-zinc-600">
                      CPMM pool:{" "}
                      {
                        pool.poolId
                      }
                    </p>

                    {pool.feeARaw !== undefined && pool.feeBRaw !== undefined ? (
                      <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">
                          On-chain creator fees
                        </p>
                        <p className="mt-2 text-sm font-bold text-white">
                          {pool.feeA} {pool.symbolA} + {pool.feeB} {pool.symbolB}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          Read directly from Raydium&apos;s CPMM PoolState on Solana RPC.
                        </p>
                        {pool.creatorMatches === false ? (
                          <p className="mt-2 text-xs font-bold text-rose-300">
                            Connected wallet does not match this CPMM pool&apos;s on-chain creator. Claim disabled.
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs leading-5 text-zinc-500">
                        Kodiak could not decode the on-chain fee counters for this pool.
                      </p>
                    )}

                    <button
                      type="button"
                      disabled={
                        busy ||
                        pool.creatorMatches === false ||
                        (pool.feeARaw === "0" && pool.feeBRaw === "0")
                      }
                      onClick={() =>
                        void claimKnownCpmmPool(
                          pool,
                        )
                      }
                      className="mt-4 rounded-xl bg-amber-300 px-4 py-3 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {claimingCpmmPool === pool.poolId
                        ? "Checking claim..."
                        : pool.feeARaw === "0" && pool.feeBRaw === "0"
                          ? "No CPMM Fees Available"
                          : "Claim CPMM Fees"}
                    </button>
                  </div>
                ),
              )}
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm leading-6 text-zinc-500">
            No graduated Kodiak CPMM pools were found for this connected creator wallet.
          </p>
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
        Post-graduation rewards use Raydium's CPMM creator-fee system and are read for the connected launch creator wallet.
      </p>
    </section>
  );
}
