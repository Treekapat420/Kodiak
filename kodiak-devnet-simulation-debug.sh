#!/usr/bin/env bash
set -euo pipefail

echo "🐻 Adding Kodiak Devnet transaction diagnostics..."

if [ ! -d "web" ]; then
  echo "Error: run this from /workspaces/Kodiak."
  exit 1
fi

python - <<'PY'
from pathlib import Path

path = Path("web/src/app/platform-setup/page.tsx")
text = path.read_text()

text = text.replace(
'''import { PublicKey } from "@solana/web3.js";''',
'''import {
  LAMPORTS_PER_SOL,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";'''
)

text = text.replace(
'''  | { kind: "error"; message: string };''',
'''  | { kind: "error"; message: string; logs?: string[] };'''
)

text = text.replace(
'''  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<SetupStatus>({''',
'''  const [confirmed, setConfirmed] = useState(false);
  const [devnetBalance, setDevnetBalance] = useState<number | null>(null);
  const [status, setStatus] = useState<SetupStatus>({'''
)

anchor = '''  useEffect(() => {
    let cancelled = false;

    async function loadConfigs() {'''

balance_effect = '''  useEffect(() => {
    let cancelled = false;

    async function loadBalance() {
      if (!publicKey) {
        setDevnetBalance(null);
        return;
      }

      try {
        const lamports = await connection.getBalance(publicKey, "confirmed");
        if (!cancelled) {
          setDevnetBalance(lamports / LAMPORTS_PER_SOL);
        }
      } catch {
        if (!cancelled) {
          setDevnetBalance(null);
        }
      }
    }

    void loadBalance();

    return () => {
      cancelled = true;
    };
  }, [connection, publicKey]);

'''

if balance_effect not in text:
    if anchor not in text:
        raise SystemExit("Could not find the config-loading effect.")
    text = text.replace(anchor, balance_effect + anchor)

text = text.replace(
'''      const { execute, extInfo } =
        await raydium.launchpad.createPlatformConfig({''',
'''      const { transaction, execute, extInfo } =
        await raydium.launchpad.createPlatformConfig({'''
)

old_execute = '''      const result = await execute({ sendAndConfirm: true });
      const platformId = extInfo.platformId.toBase58();'''

new_execute = '''      setStatus({
        kind: "working",
        message: "Simulating the Devnet transaction before opening Phantom…",
      });

      const simulation = transaction instanceof VersionedTransaction
        ? await connection.simulateTransaction(transaction, {
            commitment: "confirmed",
            replaceRecentBlockhash: true,
            sigVerify: false,
          })
        : await connection.simulateTransaction(transaction);

      const simulationLogs = simulation.value.logs ?? [];

      if (simulation.value.err) {
        const errorDetails =
          typeof simulation.value.err === "string"
            ? simulation.value.err
            : JSON.stringify(simulation.value.err);

        setStatus({
          kind: "error",
          message: `Devnet simulation failed: ${errorDetails}`,
          logs: simulationLogs,
        });
        return;
      }

      setStatus({
        kind: "working",
        message: "Simulation passed. Approve the Devnet transaction in Phantom…",
      });

      const result = await execute({ sendAndConfirm: true });
      const platformId = extInfo.platformId.toBase58();'''

if old_execute not in text:
    raise SystemExit("Could not find the existing execute block.")
text = text.replace(old_execute, new_execute)

old_catch = '''      setStatus({
        kind: "error",
        message:
          message.includes("already") || message.includes("initialized")
            ? `${message} This wallet may already own a platform configuration.`
            : message,
      });'''

new_catch = '''      const possibleLogs =
        typeof error === "object" &&
        error !== null &&
        "logs" in error &&
        Array.isArray(error.logs)
          ? error.logs.filter((item): item is string => typeof item === "string")
          : undefined;

      setStatus({
        kind: "error",
        message:
          message.includes("already") || message.includes("initialized")
            ? `${message} This wallet may already own a platform configuration.`
            : message,
        logs: possibleLogs,
      });'''

if old_catch not in text:
    raise SystemExit("Could not find the existing error handler.")
text = text.replace(old_catch, new_catch)

wallet_block = '''                <p className="mt-2 break-all rounded-2xl bg-black/25 p-4 font-mono text-sm text-emerald-300">
                  {publicKey?.toBase58() ?? "Connect a wallet"}
                </p>
              </div>'''

wallet_replacement = '''                <p className="mt-2 break-all rounded-2xl bg-black/25 p-4 font-mono text-sm text-emerald-300">
                  {publicKey?.toBase58() ?? "Connect a wallet"}
                </p>
                <p className="mt-3 text-sm text-zinc-400">
                  Devnet balance:{" "}
                  <span className="font-bold text-zinc-100">
                    {devnetBalance === null
                      ? "Checking…"
                      : `${devnetBalance.toFixed(4)} SOL`}
                  </span>
                </p>
                {devnetBalance !== null && devnetBalance < 0.01 && (
                  <p className="mt-2 text-sm font-bold text-amber-300">
                    This wallet may need more Devnet SOL to create the
                    PlatformConfig account.
                  </p>
                )}
              </div>'''

if wallet_block not in text:
    raise SystemExit("Could not find the wallet display block.")
text = text.replace(wallet_block, wallet_replacement)

status_end = '''              {status.kind === "success" && (
                <div className="mt-5">'''

logs_ui = '''              {status.kind === "error" &&
                status.logs &&
                status.logs.length > 0 && (
                  <div className="mt-5">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-red-300">
                      Solana simulation logs
                    </p>
                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/40 p-4 text-[11px] leading-5 text-zinc-300">
                      {status.logs.join("\\n")}
                    </pre>
                  </div>
                )}

'''

if logs_ui not in text:
    if status_end not in text:
        raise SystemExit("Could not find the status result section.")
    text = text.replace(status_end, logs_ui + status_end)

path.write_text(text)
PY

cd web
npm run lint
npm run build
cd ..

git add web/src/app/platform-setup/page.tsx
git commit -m "add Devnet transaction simulation diagnostics" || true
git push origin main

echo ""
echo "✅ Devnet diagnostics installed and pushed."
echo "Wait for Vercel to redeploy, refresh Kodiak in Phantom, and retry once."
echo "Kodiak will now stop before Phantom if simulation fails and show the exact logs."
