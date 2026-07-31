"use client";

import { useEffect, useMemo, useState } from "react";
import BN from "bn.js";
import { Curve, getPdaLaunchpadPoolId, PlatformConfig, TxVersion } from "@raydium-io/raydium-sdk-v2";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { KodiakWalletButton } from "@/components/wallet/KodiakWalletButton";
import { DEVNET_LAUNCHPAD_PROGRAM_ID, loadDevnetRaydium } from "@/lib/raydium/devnet";

type SavedLaunch = { mint?: string; name?: string; symbol?: string };
type Status =
  | { kind: "idle"; message: string }
  | { kind: "working"; message: string }
  | { kind: "success"; message: string; signature?: string }
  | { kind: "error"; message: string; logs?: string[] };

const LAMPORTS_PER_SOL = 1_000_000_000;

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
      if (["txId", "txid", "signature"].includes(key) && typeof item === "string") return item;
      const signature = collectSignature(item);
      if (signature) return signature;
    }
  }
  return undefined;
}

function extractLogs(error: unknown): string[] | undefined {
  if (typeof error === "object" && error !== null && "logs" in error && Array.isArray(error.logs)) {
    return error.logs.filter((entry): entry is string => typeof entry === "string");
  }
  return undefined;
}

function decimalToRawAmount(value: string, decimals: number): BN {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error("Enter a valid token amount.");
  const [whole, fraction = ""] = trimmed.split(".");
  const padded = fraction.padEnd(decimals, "0").slice(0, decimals);
  return new BN(whole || "0").mul(new BN(10).pow(new BN(decimals))).add(new BN(padded || "0"));
}

export default function TradePage() {
  const { connection } = useConnection();
  const { connected, publicKey, signAllTransactions } = useWallet();

  const [mintText, setMintText] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [buySol, setBuySol] = useState("0.001");
  const [poolIdText, setPoolIdText] = useState("");
  const [estimatedTokens, setEstimatedTokens] = useState<string | null>(null);
  const [walletSol, setWalletSol] = useState<string | null>(null);
  const [tradeMode, setTradeMode] = useState<"buy" | "sell">("buy");
  const [sellTokens, setSellTokens] = useState("");
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [tokenDecimals, setTokenDecimals] = useState<number | null>(null);
  const [estimatedSellSol, setEstimatedSellSol] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle", message: "Load the last Kodiak launch or paste a Devnet mint." });

  const normalizedMint = mintText.trim();
  const mintIsValid = useMemo(() => {
    try { new PublicKey(normalizedMint); return true; } catch { return false; }
  }, [normalizedMint]);

  useEffect(() => {
    if (!publicKey) { setWalletSol(null); return; }
    let cancelled = false;
    void connection.getBalance(publicKey, "confirmed")
      .then((lamports) => { if (!cancelled) setWalletSol((lamports / LAMPORTS_PER_SOL).toFixed(4)); })
      .catch(() => { if (!cancelled) setWalletSol(null); });
    return () => { cancelled = true; };
  }, [connection, publicKey, status.kind]);

  useEffect(() => {
    if (!publicKey || !mintIsValid) { setTokenBalance(null); setTokenDecimals(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const mintA = new PublicKey(normalizedMint);
        const [supply, accounts] = await Promise.all([
          connection.getTokenSupply(mintA, "confirmed"),
          connection.getParsedTokenAccountsByOwner(publicKey, { mint: mintA }, "confirmed"),
        ]);
        let total = 0;
        for (const account of accounts.value) {
          const data = account.account.data;
          if ("parsed" in data) {
            const amount = data.parsed?.info?.tokenAmount;
            const ui = typeof amount?.uiAmount === "number" ? amount.uiAmount : Number(amount?.uiAmountString ?? "0");
            if (Number.isFinite(ui)) total += ui;
          }
        }
        if (!cancelled) { setTokenDecimals(supply.value.decimals); setTokenBalance(total); }
      } catch {
        if (!cancelled) { setTokenBalance(0); setTokenDecimals(null); }
      }
    })();
    return () => { cancelled = true; };
  }, [connection, publicKey, mintIsValid, normalizedMint, status.kind]);

  const loadLastLaunch = () => {
    const raw = window.localStorage.getItem("kodiak-last-devnet-launch");
    if (!raw) { setStatus({ kind: "error", message: "No saved Kodiak Devnet launch was found in this Phantom browser." }); return; }
    try {
      const launch = JSON.parse(raw) as SavedLaunch;
      if (!launch.mint) throw new Error("The saved launch does not contain a mint address.");
      setMintText(launch.mint); setTokenName(launch.name ?? ""); setTokenSymbol(launch.symbol ?? "");
      setPoolIdText(""); setEstimatedTokens(null); setEstimatedSellSol(null); setSellTokens("");
      setStatus({ kind: "idle", message: "Saved Kodiak launch loaded. Now load its bonding curve." });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "The saved launch could not be read." });
    }
  };

  const loadPool = async () => {
    if (!mintIsValid) { setStatus({ kind: "error", message: "Enter a valid Solana token mint." }); return; }
    if (!publicKey || !signAllTransactions) { setStatus({ kind: "error", message: "Connect Phantom in Devnet mode first." }); return; }
    try {
      setStatus({ kind: "working", message: "Loading the Raydium LaunchLab pool from Devnet..." });
      const mintA = new PublicKey(normalizedMint);
      const poolId = getPdaLaunchpadPoolId(DEVNET_LAUNCHPAD_PROGRAM_ID, mintA, NATIVE_MINT).publicKey;
      const raydium = await loadDevnetRaydium({ connection, owner: publicKey, signAllTransactions });
      await raydium.launchpad.getRpcPoolInfo({ poolId });
      setPoolIdText(poolId.toBase58());
      setStatus({ kind: "success", message: "LaunchLab bonding-curve pool loaded from Devnet." });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Unable to load the LaunchLab pool.", logs: extractLogs(error) });
    }
  };

  async function recordTrade(input: { mint: PublicKey; signature: string; side: "buy" | "sell"; solAmount?: number; tokenAmount?: number }) {
    let recorded = false;
    for (let attempt = 0; attempt < 5 && !recorded; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2500));
      const response = await fetch(`/api/token/${input.mint.toBase58()}/trades`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: publicKey?.toBase58(), signature: input.signature, side: input.side,
          ...(input.solAmount !== undefined ? { solAmount: input.solAmount } : {}),
          ...(input.tokenAmount !== undefined ? { tokenAmount: input.tokenAmount } : {}),
        }),
      });
      if (response.ok) { recorded = true; break; }
      if (response.status !== 409) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || `The ${input.side} succeeded, but chart recording failed.`);
      }
    }
    return recorded;
  }

  const buyToken = async () => {
    if (!publicKey || !signAllTransactions) { setStatus({ kind: "error", message: "Connect Phantom in Devnet mode first." }); return; }
    if (!mintIsValid) { setStatus({ kind: "error", message: "Enter or load a valid Devnet mint first." }); return; }
    const solNumber = Number(buySol);
    if (!Number.isFinite(solNumber) || solNumber <= 0 || solNumber > 5) { setStatus({ kind: "error", message: "Enter a Devnet SOL amount greater than 0 and no more than 5." }); return; }
    const lamports = Math.round(solNumber * LAMPORTS_PER_SOL);
    if (!Number.isSafeInteger(lamports) || lamports <= 0) { setStatus({ kind: "error", message: "The SOL amount could not be converted to lamports." }); return; }
    try {
      setEstimatedTokens(null);
      setStatus({ kind: "working", message: "Loading the live curve and calculating the purchase..." });
      const mintA = new PublicKey(normalizedMint);
      const poolId = getPdaLaunchpadPoolId(DEVNET_LAUNCHPAD_PROGRAM_ID, mintA, NATIVE_MINT).publicKey;
      const raydium = await loadDevnetRaydium({ connection, owner: publicKey, signAllTransactions });
      const poolInfo = await raydium.launchpad.getRpcPoolInfo({ poolId });
      const platformAccount = await connection.getAccountInfo(poolInfo.platformId, "confirmed");
      if (!platformAccount) throw new Error("The LaunchLab PlatformConfig account was not found on Devnet.");
      const platformInfo = PlatformConfig.decode(platformAccount.data);
      const mintInfo = await raydium.token.getTokenInfo(mintA);
      const sellQuote = Curve.sellExactIn({
  poolInfo,
  amountA: rawSellAmount,
  shareFeeRate: new BN(0),
});

const minSolOut = sellQuote.amountOut
  .muln(99)
  .divn(100);

if (minSolOut.lte(new BN(0))) {
  throw new Error(
    "The bonding curve calculated zero SOL output for this sale.",
  );
}
      
      const { transaction, extInfo, execute } = await raydium.launchpad.buyToken({
        programId: DEVNET_LAUNCHPAD_PROGRAM_ID,
        mintA,
        mintAProgram: new PublicKey(mintInfo.programId),
        poolInfo,
        slippage: new BN(100),
        configInfo: poolInfo.configInfo,
        platformFeeRate: platformInfo.feeRate,
        txVersion: TxVersion.V0,
        buyAmount: new BN(lamports),
      });
      setEstimatedTokens(extInfo.decimalOutAmount.toString()); setPoolIdText(poolId.toBase58());
      setStatus({ kind: "working", message: "Simulating the buy before Phantom can sign..." });
      const simulation = transaction instanceof VersionedTransaction
        ? await connection.simulateTransaction(transaction, { commitment: "confirmed", replaceRecentBlockhash: true, sigVerify: false })
        : await connection.simulateTransaction(transaction);
      if (simulation.value.err) { setStatus({ kind: "error", message: `Buy simulation failed: ${JSON.stringify(simulation.value.err)}`, logs: simulation.value.logs ?? [] }); return; }
      setStatus({ kind: "working", message: "Simulation passed. Approve the Devnet buy in Phantom..." });
      const result = await execute({ sendAndConfirm: true });
      const signature = collectSignature(result);
      if (!signature) throw new Error("The purchase succeeded, but no transaction signature was returned.");
      setStatus({ kind: "working", message: "Purchase confirmed. Updating the token chart..." });
      const recorded = await recordTrade({ mint: mintA, signature, side: "buy", solAmount: Number(buySol) });
      setStatus({ kind: "success", message: recorded ? `${buySol} Devnet SOL purchase confirmed and added to the chart.` : `${buySol} Devnet SOL purchase confirmed. Chart indexing is still pending.`, signature });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "The Devnet purchase failed.", logs: extractLogs(error) });
    }
  };

  const sellToken = async () => {
    if (!publicKey || !signAllTransactions) { setStatus({ kind: "error", message: "Connect Phantom in Devnet mode first." }); return; }
    if (!mintIsValid) { setStatus({ kind: "error", message: "Enter or load a valid Devnet mint first." }); return; }
    if (tokenDecimals === null || tokenBalance === null) { setStatus({ kind: "error", message: "Kodiak could not read this wallet's token balance yet." }); return; }
    const sellNumber = Number(sellTokens);
    if (!Number.isFinite(sellNumber) || sellNumber <= 0) { setStatus({ kind: "error", message: "Enter a token amount greater than 0." }); return; }
    if (sellNumber > tokenBalance) { setStatus({ kind: "error", message: "The sell amount is greater than this wallet's token balance." }); return; }
    let rawSellAmount: BN;
    try { rawSellAmount = decimalToRawAmount(sellTokens, tokenDecimals); }
    catch (error) { setStatus({ kind: "error", message: error instanceof Error ? error.message : "The token amount is invalid." }); return; }
    if (rawSellAmount.lte(new BN(0))) { setStatus({ kind: "error", message: "The token amount is too small to sell." }); return; }
    try {
      setEstimatedSellSol(null);
      setStatus({ kind: "working", message: "Loading the live curve and calculating the sale..." });
      const mintA = new PublicKey(normalizedMint);
      const poolId = getPdaLaunchpadPoolId(DEVNET_LAUNCHPAD_PROGRAM_ID, mintA, NATIVE_MINT).publicKey;
      const raydium = await loadDevnetRaydium({ connection, owner: publicKey, signAllTransactions });
      const poolInfo = await raydium.launchpad.getRpcPoolInfo({ poolId });
      const platformAccount = await connection.getAccountInfo(poolInfo.platformId, "confirmed");
      if (!platformAccount) throw new Error("The LaunchLab PlatformConfig account was not found on Devnet.");
      const platformInfo = PlatformConfig.decode(platformAccount.data);
      const mintInfo = await raydium.token.getTokenInfo(mintA);
      const { transaction, extInfo, execute } = await raydium.launchpad.sellToken({
        programId: DEVNET_LAUNCHPAD_PROGRAM_ID,
        mintA,
        mintAProgram: new PublicKey(mintInfo.programId),
        mintB: NATIVE_MINT,
        poolInfo,
        configInfo: poolInfo.configInfo,
        platformFeeRate: platformInfo.feeRate,
        txVersion: TxVersion.V0,
        feePayer: publicKey,
        sellAmount: rawSellAmount,
        minAmountB: minSolOut,
        slippage: new BN(100),
      });
      const estimatedLamports = Number(extInfo.outAmount.toString());
      if (Number.isFinite(estimatedLamports)) setEstimatedSellSol((estimatedLamports / LAMPORTS_PER_SOL).toFixed(9));
      setPoolIdText(poolId.toBase58());
      setStatus({ kind: "working", message: "Simulating the sell before Phantom can sign..." });
      const simulation = transaction instanceof VersionedTransaction
        ? await connection.simulateTransaction(transaction, { commitment: "confirmed", replaceRecentBlockhash: true, sigVerify: false })
        : await connection.simulateTransaction(transaction);
      if (simulation.value.err) { setStatus({ kind: "error", message: `Sell simulation failed: ${JSON.stringify(simulation.value.err)}`, logs: simulation.value.logs ?? [] }); return; }
      setStatus({ kind: "working", message: "Simulation passed. Approve the Devnet sell in Phantom..." });
      const result = await execute({ sendAndConfirm: true });
      const signature = collectSignature(result);
      if (!signature) throw new Error("The sale succeeded, but no transaction signature was returned.");
      setStatus({ kind: "working", message: "Sale confirmed. Updating the token chart..." });
      const solAmount = Number.isFinite(estimatedLamports) ? estimatedLamports / LAMPORTS_PER_SOL : undefined;
      const recorded = await recordTrade({ mint: mintA, signature, side: "sell", solAmount, tokenAmount: sellNumber });
      setSellTokens("");
      setStatus({ kind: "success", message: recorded ? `${sellNumber.toLocaleString()} tokens sold and added to the chart.` : `${sellNumber.toLocaleString()} tokens sold. Chart indexing is still pending.`, signature });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "The Devnet sale failed.", logs: extractLogs(error) });
    }
  };

  function setSellPercent(percent: number) {
    if (tokenBalance === null || tokenBalance <= 0) { setSellTokens(""); return; }
    setSellTokens((tokenBalance * percent).toFixed(6).replace(/\.?0+$/, ""));
  }

  const symbolLabel = tokenSymbol ? (tokenSymbol.startsWith("$") ? tokenSymbol : `$${tokenSymbol}`) : "TOKEN";

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="rounded-3xl border border-emerald-400/20 bg-white/[0.03] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.24em] text-emerald-300">Kodiak Devnet</p>
              <h1 className="mt-2 text-4xl font-black">Bonding Curve Trade</h1>
              <p className="mt-3 max-w-xl text-zinc-400">Test real Raydium LaunchLab buys and sells before Mainnet.</p>
            </div>
            <KodiakWalletButton />
          </div>
        </header>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <button type="button" onClick={loadLastLaunch} className="mb-5 w-full rounded-2xl border border-amber-300/30 px-5 py-4 font-black text-amber-300">Load Last Kodiak Launch</button>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-zinc-300">Token mint</span>
            <input value={mintText} onChange={(event) => { setMintText(event.target.value); setPoolIdText(""); setEstimatedTokens(null); setEstimatedSellSol(null); setSellTokens(""); }} placeholder="Paste a Devnet LaunchLab mint" className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-4 font-mono text-sm outline-none focus:border-emerald-400/50" />
          </label>
          {(tokenName || tokenSymbol) && <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4"><p className="font-black">{tokenName || "Kodiak launch"}{tokenSymbol ? ` Â· ${symbolLabel}` : ""}</p></div>}
          <button type="button" onClick={() => void loadPool()} disabled={status.kind === "working" || !connected || !mintIsValid} className="mt-5 w-full rounded-2xl border border-emerald-400/30 px-5 py-4 font-black text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40">Load Devnet Bonding Curve</button>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <div className="mb-5 grid grid-cols-2 rounded-2xl border border-white/10 bg-black/30 p-1">
            <button type="button" onClick={() => setTradeMode("buy")} className={`rounded-xl px-4 py-3 text-sm font-black ${tradeMode === "buy" ? "bg-emerald-400 text-black" : "text-zinc-400"}`}>Buy</button>
            <button type="button" onClick={() => setTradeMode("sell")} className={`rounded-xl px-4 py-3 text-sm font-black ${tradeMode === "sell" ? "bg-rose-400 text-black" : "text-zinc-400"}`}>Sell</button>
          </div>

          {tradeMode === "buy" ? <>
            <div className="flex items-center justify-between gap-4"><h2 className="text-2xl font-black">Buy with Devnet SOL</h2><p className="text-sm text-zinc-400">Wallet: {publicKey ? walletSol ?? "Loading..." : "â"} SOL</p></div>
            <input inputMode="decimal" value={buySol} onChange={(event) => setBuySol(event.target.value)} className="mt-5 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-4 text-2xl font-black outline-none focus:border-emerald-400/50" />
            <div className="mt-3 grid grid-cols-4 gap-2">{["0.001", "0.01", "0.05", "0.1"].map((amount) => <button key={amount} type="button" onClick={() => setBuySol(amount)} className="rounded-xl border border-white/10 bg-black/30 px-2 py-3 text-sm font-bold">{amount}</button>)}</div>
            <p className="mt-4 text-xs leading-5 text-zinc-500">Slippage is fixed at 1% for this Devnet test.</p>
            <button type="button" onClick={() => void buyToken()} disabled={status.kind === "working" || !connected || !mintIsValid} className="mt-5 w-full rounded-2xl bg-gradient-to-r from-emerald-400 to-amber-300 px-6 py-4 text-lg font-black text-black disabled:cursor-not-allowed disabled:opacity-40">{status.kind === "working" ? "Preparing Devnet buy..." : "Buy on Bonding Curve"}</button>
          </> : <>
            <div className="flex items-center justify-between gap-4"><div><h2 className="text-2xl font-black">Sell {symbolLabel}</h2><p className="mt-1 text-xs text-zinc-500">Sell tokens back into the Raydium LaunchLab bonding curve.</p></div><div className="text-right"><p className="text-xs text-zinc-500">Token balance</p><p className="text-sm font-black text-emerald-300">{publicKey ? tokenBalance === null ? "Loading..." : tokenBalance.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "â"}</p></div></div>
            <input inputMode="decimal" value={sellTokens} onChange={(event) => setSellTokens(event.target.value)} placeholder="0" className="mt-5 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-4 text-2xl font-black outline-none focus:border-rose-400/50" />
            <div className="mt-3 grid grid-cols-4 gap-2">{[["25%", .25], ["50%", .5], ["75%", .75], ["MAX", 1]].map(([label, percent]) => <button key={String(label)} type="button" onClick={() => setSellPercent(Number(percent))} disabled={tokenBalance === null || tokenBalance <= 0} className="rounded-xl border border-white/10 bg-black/30 px-2 py-3 text-sm font-bold disabled:opacity-40">{String(label)}</button>)}</div>
            <p className="mt-4 text-xs leading-5 text-zinc-500">Slippage is fixed at 1% for this Devnet test.</p>
            <button type="button" onClick={() => void sellToken()} disabled={status.kind === "working" || !connected || !mintIsValid || !sellTokens || tokenBalance === null || tokenBalance <= 0} className="mt-5 w-full rounded-2xl bg-rose-400 px-6 py-4 text-lg font-black text-black disabled:cursor-not-allowed disabled:opacity-40">{status.kind === "working" ? "Preparing Devnet sell..." : "Sell on Bonding Curve"}</button>
          </>}
        </section>

        {poolIdText && <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-sm">
          <h2 className="text-xl font-black">Live quote</h2>
          {tradeMode === "buy" && estimatedTokens && <div className="mt-4"><p className="text-zinc-500">Estimated token output</p><p className="mt-1 break-all text-2xl font-black text-emerald-300">{estimatedTokens}</p></div>}
          {tradeMode === "sell" && estimatedSellSol && <div className="mt-4"><p className="text-zinc-500">Estimated SOL output</p><p className="mt-1 break-all text-2xl font-black text-rose-300">{estimatedSellSol} SOL</p></div>}
          <div className="mt-5"><p className="text-zinc-500">LaunchLab pool</p><p className="mt-1 break-all font-mono text-xs">{poolIdText}</p><a href={`https://explorer.solana.com/address/${poolIdText}?cluster=devnet`} target="_blank" rel="noreferrer" className="mt-3 inline-block font-black text-amber-300">View pool on Solana Explorer</a></div>
        </section>}

        <section className={`rounded-3xl border p-5 text-sm ${status.kind === "error" ? "border-red-400/25 bg-red-400/[0.06] text-red-100" : status.kind === "success" ? "border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-100" : "border-white/10 bg-white/[0.03] text-zinc-400"}`}>
          <p className="font-black">{status.message}</p>
          {status.kind === "success" && status.signature && <a href={`https://explorer.solana.com/tx/${status.signature}?cluster=devnet`} target="_blank" rel="noreferrer" className="mt-3 inline-block font-black text-amber-300">View transaction</a>}
          {status.kind === "error" && status.logs && status.logs.length > 0 && <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-black/50 p-4 text-[11px] leading-5 text-zinc-300">{status.logs.join("\n")}</pre>}
        </section>

        <div className="pb-8"><a href="/launch" className="inline-block rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-zinc-300">Back to Launch</a></div>
      </div>
    </main>
  );
}
