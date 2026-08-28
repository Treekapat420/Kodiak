"use client";

import Link from "next/link";
import { KODIAK_FEE_LABELS } from "@/lib/fees";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import BN from "bn.js";
import {
  getPdaLaunchpadConfigId,
  LaunchpadConfig,
  TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import { Keypair, PublicKey } from "@solana/web3.js";
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
  kodiakNetworkLabel,
} from "@/lib/solana/network";

type FormState = {
  name: string;
  symbol: string;
  description: string;
  initialBuySol: string;
  x: string;
  telegram: string;
  website: string;
  discord: string;
  supply: string;
};

type SimulationDiagnostic = {
  passed: boolean;
  transactionCount: number;
  passedCount: number;
  checkedAt: string;
  walletHandoffStarted: boolean;
  feePayer: string;
  programIds: string[];
  estimatedNetworkFeeSol: number | null;
  estimatedWalletDebitSol: number | null;
  initialBuySol: number;
  unitsConsumed: number | null;
  logs: string[];
  walletError?: string;
};

const steps = ["Project", "Branding", "Socials", "Launch", "Review"];
const NETWORK_LABEL = kodiakNetworkLabel();

const storageKey =
  KODIAK_NETWORK === "devnet"
    ? "kodiak-launch-draft-v2"
    : "kodiak-launch-draft-mainnet-v1";

const lastLaunchStorageKey =
  `kodiak-last-${KODIAK_NETWORK}-launch`;

const pendingLaunchStorageKey =
  `kodiak-pending-${KODIAK_NETWORK}-launch`;

const initialForm: FormState = {
  name: "",
  symbol: "",
  description: "",
  x: "",
  telegram: "",
  website: "",
  discord: "",
  initialBuySol: "0",
  supply: "1000000000",
};

function Field({
  label,
  value,
  placeholder,
  onChange,
  maxLength,
  hint,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  maxLength?: number;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-zinc-300">{label}</span>
      <input
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-white outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/40 focus:bg-white/[0.06]"
      />
      {hint && <span className="mt-2 block text-xs text-zinc-600">{hint}</span>}
    </label>
  );
}

function validUrl(value: string) {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export default function LaunchPage() {
  const { connection } = useConnection();
  const { connected, publicKey, signTransaction, signAllTransactions } = useWallet();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(initialForm);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [simulationDiagnostic, setSimulationDiagnostic] =
    useState<SimulationDiagnostic | null>(null);
  const [walletApprovalReady, setWalletApprovalReady] = useState(false);
  const approvalGateRef = useRef<{
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);
  const [launchStatus, setLaunchStatus] = useState<
    | { kind: "idle"; message: string }
    | { kind: "working"; message: string }
    | { kind: "success"; message: string; mint: string; signatures: string[] }
    | { kind: "error"; message: string; logs?: string[]; code?: string; action?: string; technical?: string }
  >({ kind: "idle", message: `Ready to prepare a ${NETWORK_LABEL} launch.` });

  const [recoveryWorking, setRecoveryWorking] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(storageKey);

        if (saved) {
          const parsed = JSON.parse(saved) as {
            form?: Partial<FormState>;
            logoPreview?: string | null;
            bannerPreview?: string | null;
          };

          setForm((current) => ({ ...current, ...parsed.form }));
          setLogoPreview(parsed.logoPreview ?? null);
          setBannerPreview(parsed.bannerPreview ?? null);
        }
      } catch (error) {
        console.error("Unable to restore Kodiak draft:", error);
      } finally {
        setDraftLoaded(true);
      }
    }, 0);

    return () => window.clearTimeout(restoreTimer);
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;

    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ form, logoPreview, bannerPreview }),
    );
  }, [bannerPreview, draftLoaded, form, logoPreview]);

  const projectValid =
    form.name.trim().length >= 2 &&
    form.symbol.trim().length >= 2 &&
    form.description.trim().length >= 10;

  const stepValid = [
    projectValid,
    Boolean(logoPreview),
    true,
    Number(form.supply) > 0,
    connected,
  ][step];

  const progress = ((step + 1) / steps.length) * 100;

  const previewSymbol = form.symbol
    ? `$${form.symbol.replace("$", "").toUpperCase()}`
    : "$TOKEN";

  const launchScore = useMemo(() => {
    let score = 0;

    if (form.name.trim().length >= 2) score += 10;
    if (form.symbol.trim().length >= 2) score += 10;
    if (form.description.trim().length >= 80) score += 15;
    else if (form.description.trim().length >= 10) score += 8;
    if (logoPreview) score += 15;
    if (bannerPreview) score += 8;
    if (validUrl(form.website)) score += 12;
    if (validUrl(form.x)) score += 10;
    if (validUrl(form.telegram)) score += 10;
    if (validUrl(form.discord)) score += 5;
    if (Number(form.supply) > 0) score += 5;

    return Math.min(score, 100);
  }, [bannerPreview, form, logoPreview]);

  const readiness = useMemo(
    () => [
      { label: "Token name and symbol", complete: form.name.length >= 2 && form.symbol.length >= 2 },
      { label: "Detailed description", complete: form.description.length >= 80 },
      { label: "Logo uploaded", complete: Boolean(logoPreview) },
      { label: "Banner uploaded", complete: Boolean(bannerPreview) },
      { label: "Website added", complete: validUrl(form.website) },
      { label: "X profile added", complete: validUrl(form.x) },
      { label: "Telegram added", complete: validUrl(form.telegram) },
    ],
    [bannerPreview, form, logoPreview],
  );

  const estimatedCost = "~ 0.02 SOL + network fees";

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleImage = (
    event: ChangeEvent<HTMLInputElement>,
    setter: (value: string | null) => void,
  ) => {
    const file = event.target.files?.[0];

    if (!file || !file.type.startsWith("image/")) {
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setter(String(reader.result));
    reader.readAsDataURL(file);
  };

  const clearDraft = () => {
    window.localStorage.removeItem(storageKey);
    setForm(initialForm);
    setLogoPreview(null);
    setBannerPreview(null);
    approvalGateRef.current?.reject(
      new Error("Prepared launch cancelled before wallet handoff."),
    );
    approvalGateRef.current = null;
    setWalletApprovalReady(false);
    setSimulationDiagnostic(null);
    setLaunchStatus({
      kind: "idle",
      message: `Ready to prepare a ${NETWORK_LABEL} launch.`,
    });
    setStep(0);
  };

  const dataUrlToFile = async (dataUrl: string, filename: string) => {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return new File([blob], filename, {
      type: blob.type || "image/png",
    });
  };


  async function waitForSubmittedSignature(
    signature: string,
    timeoutMs = 30_000,
  ): Promise<"confirmed" | "failed" | "unknown"> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      try {
        const response = await connection.getSignatureStatuses(
          [signature],
          {
            searchTransactionHistory: true,
          },
        );

        const status = response.value[0];

        if (status) {
          if (status.err) {
            return "failed";
          }

          if (
            status.confirmationStatus === "confirmed" ||
            status.confirmationStatus === "finalized"
          ) {
            return "confirmed";
          }
        }
      } catch (statusError) {
        console.warn(
          "Kodiak could not read submitted signature status yet:",
          statusError,
        );
      }

      await new Promise((resolve) =>
        window.setTimeout(resolve, 1200),
      );
    }

    return "unknown";
  }

  async function registerVerifiedLaunch({
    mint,
    launchSignature,
    signatures,
    createdAt,
    name,
    symbol,
  }: {
    mint: string;
    launchSignature: string;
    signatures: string[];
    createdAt: string;
    name: string;
    symbol: string;
  }) {
    if (!publicKey) {
      throw new Error("Connect the creator wallet first.");
    }

    const registrationResponse = await fetch(
      "/api/creator/launches",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mint,
          creator: publicKey.toBase58(),
          name,
          symbol,
          signature: launchSignature,
          createdAt,
        }),
      },
    );

    const registrationPayload =
      (await registrationResponse.json().catch(() => null)) as
        | {
            launch?: { mint: string };
            error?: string;
          }
        | null;

    if (
      !registrationResponse.ok ||
      !registrationPayload?.launch
    ) {
      throw new Error(
        registrationPayload?.error ||
          "The token exists on-chain, but Creator Dashboard registration failed.",
      );
    }

    window.localStorage.setItem(
      lastLaunchStorageKey,
      JSON.stringify({
        network: KODIAK_NETWORK,
        mint,
        signatures,
        name,
        symbol,
        creator: publicKey.toBase58(),
        createdAt,
      }),
    );

    window.localStorage.removeItem(
      pendingLaunchStorageKey,
    );

    return registrationPayload.launch;
  }

  async function recoverLatestOnChainLaunch() {
    if (!publicKey) {
      setRecoveryMessage("Connect the creator wallet first.");
      return;
    }

    const name = form.name.trim();
    const symbol = form.symbol
      .replace("$", "")
      .trim()
      .toUpperCase();

    if (!name || !symbol) {
      setRecoveryMessage(
        "Keep the launched token's name and symbol in the form, then try recovery again.",
      );
      return;
    }

    setRecoveryWorking(true);
    setRecoveryMessage(
      `Checking the creator wallet for the latest successful ${NETWORK_LABEL} LaunchLab creation...`,
    );

    try {
      let candidate:
        | {
            mint: string;
            signature: string;
            createdAt?: string;
          }
        | null = null;

      const pendingRaw =
        window.localStorage.getItem(
          pendingLaunchStorageKey,
        );

      if (pendingRaw) {
        try {
          const pending = JSON.parse(
            pendingRaw,
          ) as {
            mint?: string;
            signatures?: string[];
            createdAt?: string;
            creator?: string;
          };

          const signature =
            pending.signatures?.[0];

          if (
            pending.mint &&
            signature &&
            pending.creator ===
              publicKey.toBase58()
          ) {
            candidate = {
              mint: pending.mint,
              signature,
              createdAt:
                pending.createdAt,
            };
          }
        } catch {
          // Fall through to server-side recent-launch discovery.
        }
      }

      if (!candidate) {
        const recoveryResponse =
          await fetch(
            `/api/creator/launches/recover-latest?creator=${encodeURIComponent(
              publicKey.toBase58(),
            )}`,
            {
              cache: "no-store",
            },
          );

        const recoveryPayload =
          (await recoveryResponse.json().catch(() => null)) as
            | {
                candidate?: {
                  mint: string;
                  signature: string;
                  createdAt?: string;
                };
                error?: string;
              }
            | null;

        if (
          !recoveryResponse.ok ||
          !recoveryPayload?.candidate
        ) {
          throw new Error(
            recoveryPayload?.error ||
              "Kodiak could not find a recent successful LaunchLab creation for this wallet.",
          );
        }

        candidate =
          recoveryPayload.candidate;
      }

      const createdAt =
        candidate.createdAt ||
        new Date().toISOString();

      setRecoveryMessage(
        "Successful on-chain launch found. Registering it in Kodiak...",
      );

      await registerVerifiedLaunch({
        mint: candidate.mint,
        launchSignature:
          candidate.signature,
        signatures: [
          candidate.signature,
        ],
        createdAt,
        name,
        symbol,
      });

      setLaunchStatus({
        kind: "success",
        message:
          "Recovered the successful on-chain launch and added it to the Creator Dashboard.",
        mint: candidate.mint,
        signatures: [
          candidate.signature,
        ],
      });

      setRecoveryMessage(
        "Recovery complete. Do not launch the token again.",
      );
    } catch (recoveryError) {
      setRecoveryMessage(
        recoveryError instanceof Error
          ? recoveryError.message
          : "Unable to recover the recent launch.",
      );
    } finally {
      setRecoveryWorking(false);
    }
  }


  const prepareLaunchTransaction = async () => {
    if (!publicKey || !signTransaction || !signAllTransactions) {
      setLaunchStatus({
        kind: "error",
        message:
          "Connect a wallet that supports both signTransaction and signAllTransactions before preparing the launch.",
      });
      return;
    }

    if (!logoPreview) {
      setLaunchStatus({ kind: "error", message: "A token image is required." });
      return;
    }

    if (Number(form.supply) !== 1_000_000_000) {
      setLaunchStatus({
        kind: "error",
        message:
          `The first ${NETWORK_LABEL} engine currently requires a supply of exactly 1,000,000,000 tokens.`,
      });
      return;
    }

    approvalGateRef.current?.reject(
      new Error("A newer launch preparation replaced the previous one."),
    );
    approvalGateRef.current = null;
    setWalletApprovalReady(false);
    setSimulationDiagnostic(null);

    let kodiakSimulationPassed = false;
    let transactionCount = 0;
    let passedCount = 0;
    const diagnosticPrograms = new Set<string>();
    const diagnosticLogs: string[] = [];
    let estimatedNetworkFeeLamports = 0;
    let estimatedWalletDebitLamports = 0;
    let totalUnitsConsumed = 0;

    try {
      const configResponse = await fetch("/api/config", {
        cache: "no-store",
      });

      const configPayload =
        (await configResponse.json()) as {
          platformId?: string;
          network?: string;
          error?: string;
        };

      if (!configResponse.ok || !configPayload.platformId) {
        throw new Error(
          configPayload.error ||
            `Kodiak's ${NETWORK_LABEL} PlatformConfig is not available.`,
        );
      }

      if (
        configPayload.network &&
        configPayload.network !== KODIAK_NETWORK
      ) {
        throw new Error(
          `Kodiak network mismatch: the browser is using ${NETWORK_LABEL}, but /api/config returned ${configPayload.network}.`,
        );
      }

      const platformId =
        new PublicKey(configPayload.platformId);

      setLaunchStatus({
        kind: "working",
        message: "Uploading the token image and metadata to IPFS...",
      });

      const metadataForm = new FormData();
      metadataForm.append(
        "image",
        await dataUrlToFile(
          logoPreview,
          `${form.symbol.replace("$", "").toLowerCase()}-logo.png`,
        ),
      );
      metadataForm.append("name", form.name.trim());
      metadataForm.append(
        "symbol",
        form.symbol.replace("$", "").trim().toUpperCase(),
      );
      metadataForm.append("description", form.description.trim());
      metadataForm.append("website", form.website.trim());
      metadataForm.append("x", form.x.trim());
      metadataForm.append("telegram", form.telegram.trim());
      metadataForm.append("discord", form.discord.trim());

      const metadataResponse = await fetch("/api/launch-metadata", {
        method: "POST",
        body: metadataForm,
      });
      const metadataPayload = (await metadataResponse.json()) as {
        uri?: string;
        error?: string;
      };

      if (!metadataResponse.ok || !metadataPayload.uri) {
        throw new Error(
          metadataPayload.error || "Token metadata upload failed.",
        );
      }

      setLaunchStatus({
        kind: "working",
        message: "Loading Raydium LaunchLab configuration...",
      });

      const programId = KODIAK_LAUNCHPAD_PROGRAM_ID;
      const configId = getPdaLaunchpadConfigId(
        programId,
        NATIVE_MINT,
        0,
        0,
      ).publicKey;
      const configAccount = await connection.getAccountInfo(
        configId,
        "confirmed",
      );

      if (!configAccount) {
        throw new Error(
          `Raydium ${NETWORK_LABEL} LaunchLab config was not found: ${configId.toBase58()}`,
        );
      }

      const configInfo = LaunchpadConfig.decode(configAccount.data);
      const mintKeypair = Keypair.generate();

      const raydium = await loadKodiakRaydium({
        connection,
        owner: publicKey,
        signTransaction,
        signAllTransactions,
      });

      const initialBuySol = Number(form.initialBuySol.trim() || "0");

      if (!Number.isFinite(initialBuySol) || initialBuySol < 0) {
        setLaunchStatus({
          kind: "error",
          message: "Initial creator buy must be 0 or a valid SOL amount.",
        });
        return;
      }

      const initialBuyLamports = Math.round(
        initialBuySol * 1_000_000_000,
      );

      if (
        !Number.isSafeInteger(initialBuyLamports) ||
        initialBuyLamports < 0
      ) {
        setLaunchStatus({
          kind: "error",
          message: "Initial creator buy amount is invalid.",
        });
        return;
      }

      /*
       * Build helper:
       *
       * Kodiak builds once for simulation, then builds the exact same launch
       * again with the SAME mint keypair immediately before wallet approval.
       * This gives the wallet transaction a fresh Solana blockhash instead of
       * reusing the older transaction objects that were built before the
       * simulation round-trip.
       */
      const buildLaunch = () =>
        raydium.launchpad.createLaunchpad({
          programId,
          mintA: mintKeypair.publicKey,
          decimals: 6,
          name: form.name.trim(),
          symbol: form.symbol.replace("$", "").trim().toUpperCase(),
          migrateType: "cpmm",
          uri: metadataPayload.uri!,
          configId,
          configInfo,
          mintBDecimals: 9,
          platformId,
          txVersion: TxVersion.V0,
          slippage: new BN(100),
          buyAmount: new BN(initialBuyLamports),
          createOnly: initialBuyLamports === 0,
        });

      setLaunchStatus({
        kind: "working",
        message: "Building the Raydium LaunchLab transaction for simulation...",
      });

      const simulationBuild =
        await buildLaunch();

      transactionCount =
        simulationBuild.transactions.length;

      setLaunchStatus({
        kind: "working",
        message: `Simulating ${transactionCount} ${NETWORK_LABEL} launch transaction${
          transactionCount === 1 ? "" : "s"
        }...`,
      });

      for (let index = 0; index < simulationBuild.transactions.length; index += 1) {
        const transaction = simulationBuild.transactions[index];

        const programIds = transaction.message.compiledInstructions
          .map((instruction) =>
            transaction.message.staticAccountKeys[
              instruction.programIdIndex
            ]?.toBase58(),
          )
          .filter((value): value is string => Boolean(value));

        programIds.forEach((programId) =>
          diagnosticPrograms.add(programId),
        );

        const feeResult = await connection.getFeeForMessage(
          transaction.message,
          "confirmed",
        );

        if (typeof feeResult.value === "number") {
          estimatedNetworkFeeLamports += feeResult.value;
        }

        const payerBalanceBefore = await connection.getBalance(
          publicKey,
          "confirmed",
        );

        const simulation = await connection.simulateTransaction(transaction, {
          commitment: "confirmed",
          replaceRecentBlockhash: true,
          sigVerify: false,
          accounts: {
            encoding: "base64",
            addresses: [publicKey.toBase58()],
          },
        });

        const transactionLogs = simulation.value.logs ?? [];
        diagnosticLogs.push(
          `--- Transaction ${index + 1} of ${transactionCount} ---`,
          ...transactionLogs,
        );

        if (typeof simulation.value.unitsConsumed === "number") {
          totalUnitsConsumed += simulation.value.unitsConsumed;
        }

        const payerAfter = simulation.value.accounts?.[0]?.lamports;

        if (typeof payerAfter === "number") {
          estimatedWalletDebitLamports += Math.max(
            payerBalanceBefore - payerAfter,
            0,
          );
        }

        if (simulation.value.err) {
          setSimulationDiagnostic({
            passed: false,
            transactionCount,
            passedCount,
            checkedAt: new Date().toLocaleTimeString(),
            walletHandoffStarted: false,
            feePayer: publicKey.toBase58(),
            programIds: Array.from(diagnosticPrograms),
            estimatedNetworkFeeSol:
              estimatedNetworkFeeLamports > 0
                ? estimatedNetworkFeeLamports / 1_000_000_000
                : null,
            estimatedWalletDebitSol:
              estimatedWalletDebitLamports > 0
                ? estimatedWalletDebitLamports / 1_000_000_000
                : null,
            initialBuySol,
            unitsConsumed:
              totalUnitsConsumed > 0 ? totalUnitsConsumed : null,
            logs: diagnosticLogs,
          });

          setLaunchStatus({
            kind: "error",
            message: "Kodiak's safety simulation found a problem, so the wallet transaction was not sent.",
            action: "Do not keep retrying blindly. If this repeats, send Kodiak support the support code and program logs below.",
            code: "SIMULATION_FAILED",
            technical: `Simulation failed at transaction ${index + 1} of ${transactionCount}: ${JSON.stringify(simulation.value.err)}`,
            logs: simulation.value.logs ?? [],
          });
          return;
        }

        passedCount += 1;
      }

      kodiakSimulationPassed = true;

      setSimulationDiagnostic({
        passed: true,
        transactionCount,
        passedCount,
        checkedAt: new Date().toLocaleTimeString(),
        walletHandoffStarted: false,
        feePayer: publicKey.toBase58(),
        programIds: Array.from(diagnosticPrograms),
        estimatedNetworkFeeSol:
          estimatedNetworkFeeLamports > 0
            ? estimatedNetworkFeeLamports / 1_000_000_000
            : null,
        estimatedWalletDebitSol:
          estimatedWalletDebitLamports > 0
            ? estimatedWalletDebitLamports / 1_000_000_000
            : null,
        initialBuySol,
        unitsConsumed:
          totalUnitsConsumed > 0 ? totalUnitsConsumed : null,
        logs: diagnosticLogs,
      });

      /*
       * IMPORTANT: do not ask Raydium to build the launch a second time here.
       *
       * The transaction that just passed Kodiak's simulation is already the
       * transaction we want Phantom to review. Re-running createLaunchpad()
       * after simulation causes Raydium's SDK to perform additional Solana RPC
       * account reads. On public/devnet RPC those nonessential reads can be
       * rate-limited (HTTP 429), which previously turned a PASSED simulation
       * into a blocked launch before Phantom ever opened.
       *
       * simulateTransaction(..., replaceRecentBlockhash: true) does not mutate
       * the original VersionedTransaction. At wallet handoff below Kodiak
       * already replaces recentBlockhash with a brand-new blockhash, clears
       * signatures, lets Phantom sign first, then adds the mint signature.
       * Therefore the simulated build can safely be reused without another
       * Raydium SDK/RPC build round-trip.
       */
      const freshBuild = simulationBuild;

      setLaunchStatus({
        kind: "idle",
        message:
          "Kodiak simulation PASSED. Review the transaction diagnostics below. The wallet will not open until you explicitly continue.",
      });

      setWalletApprovalReady(true);

      await new Promise<void>((resolve, reject) => {
        approvalGateRef.current = { resolve, reject };
      });

      approvalGateRef.current = null;
      setWalletApprovalReady(false);

      setSimulationDiagnostic((current) =>
        current
          ? {
              ...current,
              walletHandoffStarted: true,
            }
          : current,
      );

      setLaunchStatus({
        kind: "working",
        message:
          `Opening your wallet. Phantom signs first; Kodiak adds the mint signature only after wallet approval...`,
      });

      /*
       * Phantom-first multi-signer flow:
       *
       * 1. Raydium builds the fresh unsigned VersionedTransaction.
       * 2. Phantom signs that transaction first with signTransaction().
       * 3. Kodiak adds the generated mint keypair signature afterward.
       * 4. Kodiak broadcasts the fully signed bytes and confirms them itself.
       *
       * This deliberately bypasses freshBuild.execute() so the generated mint
       * signer is not attached before Phantom gets the transaction.
       */
      const uniqueSignatures: string[] = [];

      for (let index = 0; index < freshBuild.transactions.length; index += 1) {
        const unsignedTransaction = freshBuild.transactions[index];

        /*
         * Raydium can return a transaction whose blockhash has aged while
         * Kodiak performs its safety simulation and waits for the creator to
         * review the diagnostics. Refresh it at the last possible moment,
         * immediately before Phantom signs.
         *
         * Changing the blockhash invalidates any existing signatures, so clear
         * them before wallet signing. Phantom signs first; Kodiak then adds the
         * mint keypair signature below.
         */
        const latestBlockhash =
          await connection.getLatestBlockhash("confirmed");

        unsignedTransaction.message.recentBlockhash =
          latestBlockhash.blockhash;

        unsignedTransaction.signatures =
          unsignedTransaction.signatures.map(
            () => new Uint8Array(64),
          );

        const walletSignedTransaction =
          await signTransaction(unsignedTransaction);

        walletSignedTransaction.sign([
          mintKeypair,
        ]);

        setLaunchStatus({
          kind: "working",
          message: `Broadcasting ${NETWORK_LABEL} launch transaction ${
            index + 1
          } of ${freshBuild.transactions.length}...`,
        });

        const signature =
          await connection.sendRawTransaction(
            walletSignedTransaction.serialize(),
            {
              skipPreflight: false,
              maxRetries: 5,
            },
          );

        uniqueSignatures.push(signature);

        window.localStorage.setItem(
          pendingLaunchStorageKey,
          JSON.stringify({
            network: KODIAK_NETWORK,
            mint: mintKeypair.publicKey.toBase58(),
            signatures: uniqueSignatures,
            name: form.name,
            symbol: form.symbol,
            creator: publicKey.toBase58(),
            createdAt: new Date().toISOString(),
          }),
        );

        let submittedState:
          | "confirmed"
          | "failed"
          | "unknown" = "unknown";

        try {
          const confirmation =
            await connection.confirmTransaction(
              {
                signature,
                blockhash:
                  latestBlockhash.blockhash,
                lastValidBlockHeight:
                  latestBlockhash.lastValidBlockHeight,
              },
              "confirmed",
            );

          submittedState =
            confirmation.value.err
              ? "failed"
              : "confirmed";
        } catch (confirmationError) {
          console.warn(
            "Primary launch confirmation did not complete; checking the submitted signature directly:",
            confirmationError,
          );

          submittedState =
            await waitForSubmittedSignature(
              signature,
            );
        }

        if (submittedState === "failed") {
          throw new Error(
            `Launch transaction ${index + 1} was submitted but Solana reports that it failed on-chain.`,
          );
        }

        if (submittedState === "unknown") {
          throw new Error(
            `Launch transaction ${index + 1} was submitted as ${signature}, but Kodiak could not determine its final Solana status. Do not launch again. Use "Recover recent on-chain launch" after the transaction appears in your wallet.`,
          );
        }
      }

      const mint = mintKeypair.publicKey.toBase58();
      const launchSignature = uniqueSignatures[0];

      if (!launchSignature) {
        throw new Error(
          "Kodiak did not receive a launch transaction signature. Do not launch again until the mint is checked on Solana Explorer.",
        );
      }

      if (initialBuyLamports > 0) {
        let initialBuyRecorded = false;

        for (
          let attempt = 0;
          attempt < 8 && !initialBuyRecorded;
          attempt += 1
        ) {
          if (attempt > 0) {
            await new Promise((resolve) =>
              window.setTimeout(resolve, 2500),
            );
          }

          const response = await fetch(`/api/token/${mint}/trades`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              wallet: publicKey.toBase58(),
              signatures: uniqueSignatures,
              side: "buy",
              solAmount: initialBuySol,
            }),
          });

          if (response.ok) {
            initialBuyRecorded = true;
            break;
          }

          const payload = (await response.json().catch(() => null)) as
            | { error?: string; retryable?: boolean }
            | null;

          if (response.status !== 409 || attempt === 7) {
            console.error(
              "Initial creator buy succeeded on-chain, but Kodiak could not record it:",
              payload?.error ?? response.statusText,
            );
          }
        }

        if (!initialBuyRecorded) {
          console.warn(
            "The token launched successfully, but its opening creator-buy candle has not been indexed yet.",
          );
        }
      }

      const createdAt = new Date().toISOString();

      setLaunchStatus({
        kind: "working",
        message:
          "Registering the verified launch in the Creator Dashboard...",
      });

      await registerVerifiedLaunch({
        mint,
        launchSignature,
        signatures: uniqueSignatures,
        createdAt,
        name: form.name,
        symbol: form.symbol,
      });

      setLaunchStatus({
        kind: "success",
        message:
          "Token created and automatically added to the Creator Dashboard.",
        mint,
        signatures: uniqueSignatures,
      });
    } catch (error) {
      const logs =
        typeof error === "object" &&
        error !== null &&
        "logs" in error &&
        Array.isArray(error.logs)
          ? error.logs.filter(
              (entry): entry is string => typeof entry === "string",
            )
          : undefined;

      const walletOrLaunchError =
        error instanceof Error
          ? error.message
          : `Unable to prepare the ${NETWORK_LABEL} launch.`;
      const failure = classifyKodiakFailure(
        error,
        `The ${NETWORK_LABEL} launch did not complete.`,
      );

      if (kodiakSimulationPassed) {
        setSimulationDiagnostic((current) => ({
          passed: true,
          transactionCount: current?.transactionCount ?? transactionCount,
          passedCount: current?.passedCount ?? passedCount,
          checkedAt: current?.checkedAt ?? new Date().toLocaleTimeString(),
          walletHandoffStarted: current?.walletHandoffStarted ?? false,
          feePayer: current?.feePayer ?? publicKey.toBase58(),
          programIds: current?.programIds ?? Array.from(diagnosticPrograms),
          estimatedNetworkFeeSol:
            current?.estimatedNetworkFeeSol ??
            (estimatedNetworkFeeLamports > 0
              ? estimatedNetworkFeeLamports / 1_000_000_000
              : null),
          estimatedWalletDebitSol:
            current?.estimatedWalletDebitSol ??
            (estimatedWalletDebitLamports > 0
              ? estimatedWalletDebitLamports / 1_000_000_000
              : null),
          initialBuySol: current?.initialBuySol ?? Number(form.initialBuySol || 0),
          unitsConsumed:
            current?.unitsConsumed ??
            (totalUnitsConsumed > 0 ? totalUnitsConsumed : null),
          logs: current?.logs ?? diagnosticLogs,
          walletError: walletOrLaunchError,
        }));

        setLaunchStatus({
          kind: "error",
          message: failure.message,
          action: failure.action,
          code: failure.code,
          technical: `Simulation passed; post-simulation failure: ${walletOrLaunchError}`,
          logs,
        });
        return;
      }

      setLaunchStatus({
        kind: "error",
        message: failure.message,
        action: failure.action,
        code: failure.code,
        technical: failure.technical,
        logs,
      });
    }
  };

  const continueToWallet = () => {
    if (!walletApprovalReady || !approvalGateRef.current) {
      return;
    }

    approvalGateRef.current.resolve();
  };

  const cancelPreparedLaunch = () => {
    if (!approvalGateRef.current) {
      return;
    }

    approvalGateRef.current.reject(
      new Error("Prepared launch cancelled before wallet handoff."),
    );
    approvalGateRef.current = null;
    setWalletApprovalReady(false);
  };

  return (
    <main className="min-h-screen bg-[#070707] px-4 py-6 text-zinc-100 sm:px-8 lg:py-10">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.24em] text-emerald-300">
              Creator Studio
            </p>
            <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl">
              Launch your token
            </h1>
            <p className="mt-3 max-w-2xl text-zinc-400">
              Build, score, preview, and review your Kodiak launch before signing.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={clearDraft}
              className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-zinc-400"
            >
              Clear draft
            </button>
            <Link
              href="/"
              className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-zinc-300"
            >
              Exit
            </Link>
          </div>
        </div>

        <div className="mt-8 h-2 overflow-hidden rounded-full bg-zinc-900">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-amber-300 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="mt-5 grid grid-cols-5 gap-2">
          {steps.map((label, index) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                if (index <= step) setStep(index);
              }}
              className={`rounded-xl px-1 py-3 text-[11px] font-black transition sm:px-3 sm:text-sm ${
                index === step
                  ? "bg-emerald-400 text-black"
                  : index < step
                    ? "bg-emerald-400/10 text-emerald-300"
                    : "bg-white/[0.04] text-zinc-500"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-8 grid gap-7 xl:grid-cols-[1.1fr_.9fr]">
          <section className="rounded-[2rem] border border-white/10 bg-white/[0.025] p-5 sm:p-8">
            {step === 0 && (
              <div className="space-y-5">
                <div>
                  <p className="text-sm font-bold text-emerald-300">Step 1 of 5</p>
                  <h2 className="mt-2 text-2xl font-black">Project details</h2>
                </div>

                <Field
                  label="Token name"
                  value={form.name}
                  placeholder="Kodiak Coin"
                  onChange={(value) => update("name", value)}
                  maxLength={32}
                />

                <Field
                  label="Symbol"
                  value={form.symbol}
                  placeholder="KODIAK"
                  onChange={(value) =>
                    update("symbol", value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase())
                  }
                  maxLength={10}
                  hint="Letters and numbers only."
                />

                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-zinc-300">
                    Description
                  </span>
                  <textarea
                    value={form.description}
                    onChange={(event) => update("description", event.target.value)}
                    placeholder="Tell the community what your project is about."
                    maxLength={500}
                    className="min-h-44 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-white outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/40"
                  />
                  <div className="mt-2 flex justify-between text-xs">
                    <span className={form.description.length >= 80 ? "text-emerald-300" : "text-zinc-600"}>
                      80+ characters recommended
                    </span>
                    <span className="text-zinc-600">{form.description.length}/500</span>
                  </div>
                </label>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <p className="text-sm font-bold text-emerald-300">Step 2 of 5</p>
                  <h2 className="mt-2 text-2xl font-black">Branding</h2>
                </div>

                <label className="block rounded-3xl border border-dashed border-white/15 bg-black/20 p-6 text-center">
                  <span className="text-lg font-black">Upload token logo</span>
                  <span className="mt-2 block text-sm text-zinc-500">
                    Square PNG, JPG, or WEBP recommended
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => handleImage(event, setLogoPreview)}
                    className="mt-5 block w-full text-sm text-zinc-500 file:mr-4 file:rounded-xl file:border-0 file:bg-emerald-400 file:px-4 file:py-3 file:font-black file:text-black"
                  />
                </label>

                <label className="block rounded-3xl border border-dashed border-white/15 bg-black/20 p-6 text-center">
                  <span className="text-lg font-black">Upload banner</span>
                  <span className="mt-2 block text-sm text-zinc-500">
                    Optional, but improves your Launch Score
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => handleImage(event, setBannerPreview)}
                    className="mt-5 block w-full text-sm text-zinc-500 file:mr-4 file:rounded-xl file:border-0 file:bg-amber-300 file:px-4 file:py-3 file:font-black file:text-black"
                  />
                </label>

                <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.04] p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-black text-white">
                        Initial creator buy
                      </p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">
                        Optional. Be the first buyer of your token when it launches.
                        Leave this at 0 to launch without buying.
                      </p>
                    </div>

                    <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-300">
                      OPTIONAL
                    </span>
                  </div>

                  <div className="mt-4 flex items-center rounded-2xl border border-white/10 bg-black/40 px-4">
                    <input
                      inputMode="decimal"
                      value={form.initialBuySol}
                      onChange={(event) => update("initialBuySol", event.target.value)}
                      placeholder="0"
                      className="w-full bg-transparent py-4 text-xl font-black text-white outline-none placeholder:text-zinc-700"
                    />
                    <span className="ml-3 text-sm font-black text-emerald-300">
                      SOL
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {["0", "0.1", "0.5", "1"].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => update("initialBuySol", amount)}
                        className="rounded-xl border border-white/10 bg-black/30 px-2 py-3 text-sm font-bold text-zinc-300 transition hover:border-emerald-400/40 hover:text-emerald-300"
                      >
                        {amount === "0" ? "None" : `${amount} SOL`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <div>
                  <p className="text-sm font-bold text-emerald-300">Step 3 of 5</p>
                  <h2 className="mt-2 text-2xl font-black">Community links</h2>
                </div>

                <Field label="X / Twitter" value={form.x} placeholder="https://x.com/..." onChange={(value) => update("x", value)} />
                <Field label="Telegram" value={form.telegram} placeholder="https://t.me/..." onChange={(value) => update("telegram", value)} />
                <Field label="Website" value={form.website} placeholder="https://..." onChange={(value) => update("website", value)} />
                <Field label="Discord (optional)" value={form.discord} placeholder="https://discord.gg/..." onChange={(value) => update("discord", value)} />
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6">
                <div>
                  <p className="text-sm font-bold text-emerald-300">Step 4 of 5</p>
                  <h2 className="mt-2 text-2xl font-black">Launch settings</h2>
                </div>

                <Field
                  label="Total supply"
                  value={form.supply}
                  placeholder="1000000000"
                  onChange={(value) => update("supply", value.replace(/\D/g, ""))}
                />

                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] p-5">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-300">
                    Fixed migration policy
                  </p>

                  <h3 className="mt-2 text-lg font-black">
                    90% burned - 10% creator Fee Key
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-zinc-400">
                    When a Kodiak launch graduates to Raydium CPMM, 90% of the
                    migrated LP ownership is permanently burned. The creator
                    receives the 10% Fee Key share configured by Kodiak&apos;s
                    on-chain PlatformConfig.
                  </p>

                  <p className="mt-2 text-xs leading-5 text-zinc-600">
                    Creators cannot switch this to keep or withdraw the migrated
                    liquidity on an individual launch. Kodiak&apos;s platform LP
                    share is 0%.
                  </p>
                </div>

                <div className="rounded-2xl border border-amber-400/15 bg-amber-400/[0.06] p-5">
                  <p className="text-sm text-amber-200">Estimated launch cost</p>
                  <p className="mt-2 text-2xl font-black text-amber-300">{estimatedCost}</p>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-6">
                <div>
                  <p className="text-sm font-bold text-emerald-300">Step 5 of 5</p>
                  <h2 className="mt-2 text-2xl font-black">Review launch</h2>
                </div>

                <div className="space-y-3 rounded-3xl border border-white/10 bg-black/20 p-5">
                  {[
                    ["Name", form.name || "Not entered"],
                    ["Symbol", previewSymbol],
                    ["Supply", Number(form.supply || 0).toLocaleString()],
                    ["Migrated LP policy", "90% burned / 10% creator Fee Key"],
                    ["Bonding creator fee", KODIAK_FEE_LABELS.creatorCurve],
                    ["Platform LP share", "0%"],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-5 border-b border-white/5 pb-3 last:border-0 last:pb-0">
                      <span className="text-zinc-500">{label}</span>
                      <span className="text-right font-bold">{value}</span>
                    </div>
                  ))}
                </div>

                {!connected ? (
                  <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.06] p-6 text-center">
                    <p className="font-black">Connect your wallet to continue</p>
                    <div className="mt-5 flex justify-center">
                      <KodiakWalletButton />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <button
                      type="button"
                      onClick={() => void prepareLaunchTransaction()}
                      disabled={launchStatus.kind === "working"}
                      className="w-full rounded-2xl bg-gradient-to-r from-emerald-400 to-amber-300 px-6 py-4 text-lg font-black text-black disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {launchStatus.kind === "working"
                        ? `Preparing ${NETWORK_LABEL} launch...`
                        : "Prepare Launch Transaction"}
                    </button>

                    {simulationDiagnostic && (
                      <div
                        className={`rounded-2xl border p-4 ${
                          simulationDiagnostic.passed
                            ? "border-emerald-400/30 bg-emerald-400/[0.07]"
                            : "border-red-400/30 bg-red-400/[0.07]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-4">
                          <p
                            className={`text-sm font-black ${
                              simulationDiagnostic.passed
                                ? "text-emerald-300"
                                : "text-red-300"
                            }`}
                          >
                            Kodiak pre-wallet simulation:{" "}
                            {simulationDiagnostic.passed ? "PASSED" : "FAILED"}
                          </p>
                          <span className="text-xs text-zinc-600">
                            {simulationDiagnostic.checkedAt}
                          </span>
                        </div>

                        <p className="mt-2 text-xs leading-5 text-zinc-400">
                          {simulationDiagnostic.passedCount} of{" "}
                          {simulationDiagnostic.transactionCount} transaction
                          {simulationDiagnostic.transactionCount === 1 ? "" : "s"}{" "}
                          passed Kodiak&apos;s Solana RPC simulation.
                        </p>

                        <div className="mt-4 grid gap-3 text-xs">
                          <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                            <p className="font-black uppercase tracking-[0.12em] text-zinc-500">
                              Fee payer
                            </p>
                            <p className="mt-2 break-all font-mono text-zinc-300">
                              {simulationDiagnostic.feePayer}
                            </p>
                          </div>

                          <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                            <p className="font-black uppercase tracking-[0.12em] text-zinc-500">
                              Estimated SOL impact
                            </p>
                            <p className="mt-2 text-zinc-300">
                              Simulated wallet debit: {simulationDiagnostic.estimatedWalletDebitSol === null
                                ? "Unavailable"
                                : `${simulationDiagnostic.estimatedWalletDebitSol.toFixed(9)} SOL`}
                            </p>
                            <p className="mt-1 text-zinc-500">
                              Estimated network fee: {simulationDiagnostic.estimatedNetworkFeeSol === null
                                ? "Unavailable"
                                : `${simulationDiagnostic.estimatedNetworkFeeSol.toFixed(9)} SOL`}
                            </p>
                            <p className="mt-1 text-zinc-500">
                              Initial creator buy: {simulationDiagnostic.initialBuySol.toFixed(9)} SOL
                            </p>
                          </div>

                          <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                            <p className="font-black uppercase tracking-[0.12em] text-zinc-500">
                              Programs invoked
                            </p>
                            <div className="mt-2 space-y-1">
                              {simulationDiagnostic.programIds.map((programId) => (
                                <p key={programId} className="break-all font-mono text-zinc-300">
                                  {programId}
                                </p>
                              ))}
                            </div>
                          </div>

                          <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                            <p className="font-black uppercase tracking-[0.12em] text-zinc-500">
                              Simulation compute
                            </p>
                            <p className="mt-2 text-zinc-300">
                              {simulationDiagnostic.unitsConsumed === null
                                ? "Unavailable"
                                : `${simulationDiagnostic.unitsConsumed.toLocaleString()} compute units`}
                            </p>
                          </div>

                          <details className="rounded-xl border border-white/10 bg-black/25 p-3">
                            <summary className="cursor-pointer font-black text-zinc-300">
                              Full Solana simulation logs ({simulationDiagnostic.logs.length})
                            </summary>
                            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-5 text-zinc-400">
                              {simulationDiagnostic.logs.length > 0
                                ? simulationDiagnostic.logs.join("\n")
                                : "No program logs were returned."}
                            </pre>
                          </details>
                        </div>

                        {walletApprovalReady && simulationDiagnostic.passed && (
                          <div className="mt-4 rounded-xl border border-amber-300/30 bg-amber-300/[0.06] p-4">
                            <p className="text-sm font-black text-amber-300">
                              Wallet handoff is paused
                            </p>
                            <p className="mt-2 text-xs leading-5 text-zinc-400">
                              Review the fee payer, SOL impact, programs, and complete simulation logs above. Kodiak will not open the wallet until you continue.
                            </p>
                            <div className="mt-4 grid gap-2 sm:grid-cols-2">
                              <button
                                type="button"
                                onClick={cancelPreparedLaunch}
                                className="rounded-xl border border-white/10 px-4 py-3 font-black text-zinc-300"
                              >
                                Cancel prepared launch
                              </button>
                              <button
                                type="button"
                                onClick={continueToWallet}
                                className="rounded-xl bg-amber-300 px-4 py-3 font-black text-black"
                              >
                                Continue to wallet
                              </button>
                            </div>
                          </div>
                        )}

                        {simulationDiagnostic.walletHandoffStarted && (
                          <p className="mt-2 text-xs leading-5 text-zinc-400">
                            Phantom receives the fresh transaction before Kodiak adds
                            the mint signature.
                          </p>
                        )}

                        {simulationDiagnostic.walletError && (
                          <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-3">
                            <p className="text-xs font-black text-amber-300">
                              Wallet / transaction response
                            </p>
                            <p className="mt-1 break-words text-xs leading-5 text-zinc-300">
                              {simulationDiagnostic.walletError}
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    <div
                      className={`rounded-2xl border p-4 text-sm ${
                        launchStatus.kind === "error"
                          ? "border-red-400/20 bg-red-400/[0.06] text-red-100"
                          : launchStatus.kind === "success"
                            ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-100"
                            : "border-white/10 bg-black/20 text-zinc-400"
                      }`}
                    >
                      <p className="font-bold">{launchStatus.message}</p>

                      {launchStatus.kind === "error" && launchStatus.action && (
                        <div className="mt-3 rounded-xl border border-red-300/15 bg-black/30 p-3">
                          <p className="text-xs font-black uppercase tracking-[0.12em] text-red-200">What to do</p>
                          <p className="mt-2 text-xs leading-5 text-zinc-300">{launchStatus.action}</p>
                          {launchStatus.code && (
                            <p className="mt-3 font-mono text-[11px] text-zinc-500">Support code: {launchStatus.code}</p>
                          )}
                          {launchStatus.technical && (
                            <details className="mt-3">
                              <summary className="cursor-pointer text-xs font-bold text-zinc-400">Technical details</summary>
                              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-5 text-zinc-500">{launchStatus.technical}</pre>
                            </details>
                          )}
                        </div>
                      )}

                      {launchStatus.kind === "error" &&
                        launchStatus.logs &&
                        launchStatus.logs.length > 0 && (
                          <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/40 p-3 text-[11px] leading-5 text-zinc-300">
                            {launchStatus.logs.join("\n")}
                          </pre>
                        )}

                      {connected &&
                        launchStatus.kind !== "working" && (
                          <div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] p-3">
                            <p className="text-xs font-bold text-zinc-300">
                              Already succeeded on-chain but missing from Kodiak?
                            </p>
                            <button
                              type="button"
                              disabled={recoveryWorking}
                              onClick={() => {
                                void recoverLatestOnChainLaunch();
                              }}
                              className="mt-3 rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-xs font-black text-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {recoveryWorking
                                ? "Checking Solana..."
                                : "Recover recent on-chain launch"}
                            </button>
                            {recoveryMessage && (
                              <p className="mt-2 break-words text-xs leading-5 text-zinc-400">
                                {recoveryMessage}
                              </p>
                            )}
                          </div>
                        )}

                      {launchStatus.kind === "success" && (
                        <div className="mt-4 space-y-3">
                          <div>
                            <p className="text-xs text-emerald-200/70">
                              {NETWORK_LABEL} mint
                            </p>
                            <p className="mt-1 break-all rounded-xl bg-black/30 p-3 font-mono text-xs">
                              {launchStatus.mint}
                            </p>
                          </div>
                          <a
                            href={kodiakExplorerAddressUrl(launchStatus.mint)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block font-black text-amber-300"
                          >
                            View mint on Solana Explorer
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          <aside className="space-y-5 xl:sticky xl:top-6 xl:self-start">
            <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950">
              {bannerPreview ? (
                <div className="relative h-24 overflow-hidden sm:h-36">
                  <img
                    src={bannerPreview}
                    alt="Token banner preview"
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : null}

              <div className="p-4 sm:p-6">
                <div className={`flex items-end justify-between ${bannerPreview ? "-mt-10 sm:-mt-14" : "mt-0"}`}>
                  <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-3xl sm:h-24 sm:w-24 border-4 border-zinc-950 bg-gradient-to-br from-amber-300 to-orange-500 text-2xl font-black text-black">
                    {logoPreview ? (
                      <img src={logoPreview} alt="Token logo preview" className="h-full w-full object-cover" />
                    ) : (
                      previewSymbol.slice(1, 3)
                    )}
                  </div>
                  <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-300">
                    Preview
                  </span>
                </div>

                <h3 className="mt-5 text-2xl font-black">{form.name || "Your token name"}</h3>
                <p className="mt-1 font-bold text-amber-300">{previewSymbol}</p>
                <p className="mt-4 min-h-20 leading-7 text-zinc-400">
                  {form.description || "Your project description will appear here as you type."}
                </p>
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-white/[0.025] p-6">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-sm font-bold uppercase tracking-[0.18em] text-zinc-500">
                    Kodiak Launch Score
                  </p>
                  <p className="mt-2 text-5xl font-black">{launchScore}</p>
                </div>
                <p className="pb-1 text-xl font-black text-zinc-600">/100</p>
              </div>

              <div className="mt-5 h-3 overflow-hidden rounded-full bg-zinc-900">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-amber-300 transition-all duration-300"
                  style={{ width: `${launchScore}%` }}
                />
              </div>

              <div className="mt-6 space-y-3">
                {readiness.map((item) => (
                  <div key={item.label} className="flex items-center gap-3 text-sm">
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-black ${
                        item.complete
                          ? "bg-emerald-400/15 text-emerald-300"
                          : "bg-white/[0.05] text-zinc-600"
                      }`}
                    >
                      {item.complete ? "OK" : "-"}
                    </span>
                    <span className={item.complete ? "text-zinc-300" : "text-zinc-600"}>
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>

        <div className="mt-7 flex items-center justify-between gap-4">
          <button
            type="button"
            disabled={step === 0}
            onClick={() => setStep((current) => Math.max(current - 1, 0))}
            className="rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-4 font-black disabled:cursor-not-allowed disabled:opacity-30"
          >
            Back
          </button>

          {step < 4 && (
            <button
              type="button"
              disabled={!stepValid}
              onClick={() => {
                if (stepValid) {
                  setStep((current) => Math.min(current + 1, 4));
                  window.setTimeout(() => {
                    window.scrollTo({
                      top: 0,
                      left: 0,
                      behavior: "smooth",
                    });
                  }, 0);
                }
              }}
              className="rounded-2xl bg-emerald-400 px-7 py-4 font-black text-black transition disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              Continue
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
