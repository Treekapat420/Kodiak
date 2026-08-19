"use client";

import { useMemo, useState } from "react";

type DiagnosticCheck = {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
};

type DiagnosticTx = {
  signature: string;
  slot: number;
  blockTime: number | null;
  confirmationStatus: string | null;
  err: unknown;
  memo: string | null;
  logs: string[] | null;
};

type Diagnostics = {
  network: string;
  generatedAt: string;
  mint: string;
  state: string;
  rawStatus: number;
  launchpadPoolId: string;
  launchpadProgramId: string;
  launchpadAccountSlot: number;
  platformId: string;
  configuredKodiakPlatformId: string;
  belongsToKodiak: boolean;
  migrateTypeRaw: number;
  migrateType: string;
  mintA: string;
  mintB: string;
  bonding: {
    quoteCollectedRaw: string;
    quoteCollectedSol: string;
    quoteTargetRaw: string;
    quoteTargetSol: string;
    remainingRaw: string;
    remainingSol: string;
    progressBps: number;
    progressPercent: number;
    thresholdReached: boolean;
  };
  platform: {
    accountExists: boolean;
    ownerMatchesLaunchLab: boolean;
    cpConfigId: string | null;
    platformFeeRate: string | null;
    creatorFeeRate: string | null;
    mainnetCpmmMatches: boolean;
  };
  cpmm: {
    programId: string;
    poolId: string | null;
    candidates: Array<{ address: string; exists: boolean; ownerMatches: boolean }>;
  };
  trading: {
    launchpadActive: boolean;
    graduationReady: boolean;
    graduated: boolean;
    cancelled: boolean;
    cpmmReady: boolean;
  };
  checks: DiagnosticCheck[];
  transactions: {
    launchpadPool: DiagnosticTx[];
    cpmmPool: DiagnosticTx[];
  };
};

function short(value: string) {
  return value.length > 22 ? `${value.slice(0, 10)}...${value.slice(-8)}` : value;
}

function explorerUrl(signature: string, network: string) {
  const cluster = network.toLowerCase().includes("devnet") ? "?cluster=devnet" : "";
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
}

function addressExplorerUrl(address: string, network: string) {
  const cluster = network.toLowerCase().includes("devnet") ? "?cluster=devnet" : "";
  return `https://explorer.solana.com/address/${address}${cluster}`;
}

function StateBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <div className={`rounded-2xl border p-3 ${active ? "border-amber-300/40 bg-amber-300/10" : "border-white/10 bg-white/[0.025]"}`}>
      <p className={`text-xs font-black uppercase tracking-[0.15em] ${active ? "text-amber-200" : "text-zinc-600"}`}>{label}</p>
    </div>
  );
}

export function GraduationDiagnostics() {
  const [mint, setMint] = useState("");
  const [data, setData] = useState<Diagnostics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const failedChecks = useMemo(() => data?.checks.filter((check) => !check.pass) ?? [], [data]);

  async function inspect() {
    const value = mint.trim();
    if (!value) return;

    setLoading(true);
    setError("");
    setData(null);

    try {
      const response = await fetch(`/api/token/${encodeURIComponent(value)}/graduation/diagnostics`, {
        cache: "no-store",
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body?.error || "Unable to load graduation diagnostics.");
      }

      setData(body as Diagnostics);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load graduation diagnostics.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-8 rounded-[2rem] border border-white/10 bg-white/[0.025] p-5 sm:p-7">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">Graduation diagnostics</p>
          <h2 className="mt-2 text-2xl font-black">Inspect any Kodiak launch</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
            Reads live LaunchLab state, graduation progress, PlatformConfig, expected CPMM pool and recent on-chain transactions. No creator wallet access is required.
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <input
          value={mint}
          onChange={(event) => setMint(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void inspect();
          }}
          placeholder="Paste token mint address"
          className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-amber-300/40"
        />
        <button
          type="button"
          onClick={() => void inspect()}
          disabled={loading || !mint.trim()}
          className="rounded-2xl bg-amber-300 px-5 py-3 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Inspecting..." : "Run diagnostics"}
        </button>
      </div>

      {error && (
        <div className="mt-5 rounded-2xl border border-rose-400/20 bg-rose-400/[0.05] p-4 text-sm text-rose-200">{error}</div>
      )}

      {data && (
        <div className="mt-6 space-y-6">
          <div className={`rounded-2xl border p-4 ${failedChecks.length ? "border-amber-300/25 bg-amber-300/[0.04]" : "border-emerald-400/25 bg-emerald-400/[0.04]"}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.15em] text-zinc-500">Live status</p>
                <p className="mt-1 text-xl font-black capitalize text-zinc-100">{data.state}</p>
              </div>
              <div className="text-right text-xs text-zinc-600">
                <p>{data.network}</p>
                <p>{new Date(data.generatedAt).toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StateBadge label="Curve active" active={data.trading.launchpadActive} />
            <StateBadge label="Ready to graduate" active={data.trading.graduationReady} />
            <StateBadge label="Graduated" active={data.trading.graduated} />
            <StateBadge label="CPMM ready" active={data.trading.cpmmReady} />
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.15em] text-zinc-600">Bonding progress</p>
                <p className="mt-1 text-2xl font-black text-zinc-100">{data.bonding.progressPercent.toFixed(2)}%</p>
              </div>
              <p className="text-right text-sm font-bold text-amber-200">
                {data.bonding.quoteCollectedSol} / {data.bonding.quoteTargetSol} SOL
              </p>
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/5">
              <div className="h-full rounded-full bg-amber-300" style={{ width: `${Math.min(100, data.bonding.progressPercent)}%` }} />
            </div>
            <p className="mt-3 text-xs text-zinc-600">Remaining to threshold: {data.bonding.remainingSol} SOL</p>
          </div>

          <div>
            <h3 className="text-sm font-black uppercase tracking-[0.15em] text-zinc-400">Safety checks</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {data.checks.map((check) => (
                <div key={check.id} className={`rounded-2xl border p-4 ${check.pass ? "border-emerald-400/15 bg-emerald-400/[0.03]" : "border-rose-400/20 bg-rose-400/[0.04]"}`}>
                  <p className={`text-sm font-black ${check.pass ? "text-emerald-300" : "text-rose-300"}`}>
                    {check.pass ? "PASS" : "ATTENTION"} Â· {check.label}
                  </p>
                  <p className="mt-2 break-all text-xs leading-5 text-zinc-500">{check.detail}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <h3 className="text-sm font-black text-zinc-200">LaunchLab / PlatformConfig</h3>
              <dl className="mt-4 space-y-3 text-xs">
                <div><dt className="text-zinc-600">Token mint</dt><dd className="mt-1 break-all font-bold text-zinc-300">{data.mint}</dd></div>
                <div><dt className="text-zinc-600">LaunchLab pool</dt><dd className="mt-1"><a className="break-all font-bold text-amber-200 hover:underline" href={addressExplorerUrl(data.launchpadPoolId, data.network)} target="_blank" rel="noreferrer">{data.launchpadPoolId}</a></dd></div>
                <div><dt className="text-zinc-600">PlatformConfig</dt><dd className="mt-1 break-all font-bold text-zinc-300">{data.platformId}</dd></div>
                <div><dt className="text-zinc-600">CPMM config</dt><dd className="mt-1 break-all font-bold text-zinc-300">{data.platform.cpConfigId ?? "Not available yet"}</dd></div>
                <div><dt className="text-zinc-600">Platform fee raw</dt><dd className="mt-1 font-bold text-zinc-300">{data.platform.platformFeeRate ?? "Unavailable"}</dd></div>
                <div><dt className="text-zinc-600">Creator fee raw</dt><dd className="mt-1 font-bold text-zinc-300">{data.platform.creatorFeeRate ?? "Unavailable"}</dd></div>
              </dl>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <h3 className="text-sm font-black text-zinc-200">CPMM migration target</h3>
              <dl className="mt-4 space-y-3 text-xs">
                <div><dt className="text-zinc-600">CPMM program</dt><dd className="mt-1 break-all font-bold text-zinc-300">{data.cpmm.programId}</dd></div>
                <div><dt className="text-zinc-600">Detected pool</dt><dd className="mt-1 break-all font-bold text-zinc-300">{data.cpmm.poolId ?? "Not detected"}</dd></div>
              </dl>
              <div className="mt-4 space-y-2">
                {data.cpmm.candidates.map((candidate) => (
                  <div key={candidate.address} className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-xs">
                    <p className="break-all font-bold text-zinc-300">{candidate.address}</p>
                    <p className="mt-1 text-zinc-600">exists: {String(candidate.exists)} Â· owner matches: {String(candidate.ownerMatches)}</p>
                  </div>
                ))}
                {!data.cpmm.candidates.length && <p className="text-xs text-zinc-600">CPMM candidates become available when the PlatformConfig can be decoded.</p>}
              </div>
            </div>
          </div>

          <TransactionList title="Recent LaunchLab pool transactions" transactions={data.transactions.launchpadPool} network={data.network} />
          {data.transactions.cpmmPool.length > 0 && (
            <TransactionList title="Recent CPMM pool transactions" transactions={data.transactions.cpmmPool} network={data.network} />
          )}
        </div>
      )}
    </section>
  );
}

function TransactionList({ title, transactions, network }: { title: string; transactions: DiagnosticTx[]; network: string }) {
  return (
    <div>
      <h3 className="text-sm font-black uppercase tracking-[0.15em] text-zinc-400">{title}</h3>
      <div className="mt-3 space-y-2">
        {transactions.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-zinc-600">No recent signatures found for this account.</div>
        )}
        {transactions.map((tx) => (
          <details key={tx.signature} className={`rounded-2xl border p-4 ${tx.err ? "border-rose-400/20 bg-rose-400/[0.04]" : "border-white/10 bg-black/25"}`}>
            <summary className="cursor-pointer list-none">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <a href={explorerUrl(tx.signature, network)} target="_blank" rel="noreferrer" className="font-black text-amber-200 hover:underline" onClick={(event) => event.stopPropagation()}>
                    {short(tx.signature)}
                  </a>
                  <p className="mt-1 text-xs text-zinc-600">slot {tx.slot}{tx.blockTime ? ` Â· ${new Date(tx.blockTime * 1000).toLocaleString()}` : ""}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-black ${tx.err ? "bg-rose-400/10 text-rose-300" : "bg-emerald-400/10 text-emerald-300"}`}>
                  {tx.err ? "FAILED" : tx.confirmationStatus?.toUpperCase() || "CONFIRMED"}
                </span>
              </div>
            </summary>
            <div className="mt-4 border-t border-white/5 pt-4">
              {Boolean(tx.err) && (
                <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-black/40 p-3 text-xs text-rose-200">{JSON.stringify(tx.err, null, 2)}</pre>
              )}
              {tx.logs?.length ? (
                <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-black/40 p-3 text-[11px] leading-5 text-zinc-500">{tx.logs.join("\n")}</pre>
              ) : (
                <p className="text-xs text-zinc-600">Detailed logs were not loaded for this transaction. Open it in Solana Explorer for the full record.</p>
              )}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
