#!/usr/bin/env bash
set -euo pipefail

echo "🐻 Installing Kodiak Devnet token launch engine..."

if [ ! -d "web" ]; then
  echo "Error: run this from /workspaces/Kodiak."
  exit 1
fi

mkdir -p web/src/app/api/launch-metadata

cat > web/src/app/api/launch-metadata/route.ts <<'EOF'
import { NextResponse } from "next/server";

const PINATA_FILE_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const PINATA_JSON_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS";
const PUBLIC_GATEWAY = "https://gateway.pinata.cloud/ipfs";

type PinataResponse = {
  IpfsHash?: string;
  error?: string;
};

function cleanOptionalUrl(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export async function POST(request: Request) {
  const jwt = process.env.PINATA_JWT;

  if (!jwt) {
    return NextResponse.json(
      {
        error:
          "Metadata storage is not configured. Add PINATA_JWT to the Vercel project environment variables.",
      },
      { status: 503 },
    );
  }

  try {
    const incoming = await request.formData();
    const image = incoming.get("image");
    const name = String(incoming.get("name") ?? "").trim();
    const symbol = String(incoming.get("symbol") ?? "")
      .replace("$", "")
      .trim()
      .toUpperCase();
    const description = String(incoming.get("description") ?? "").trim();

    if (!(image instanceof File) || image.size === 0) {
      return NextResponse.json(
        { error: "A token image is required." },
        { status: 400 },
      );
    }

    if (!name || !symbol || !description) {
      return NextResponse.json(
        { error: "Name, symbol, and description are required." },
        { status: 400 },
      );
    }

    const imageUpload = new FormData();
    imageUpload.append("file", image, image.name || `${symbol}-logo.png`);
    imageUpload.append(
      "pinataMetadata",
      JSON.stringify({ name: `${name} token image` }),
    );

    const imageResponse = await fetch(PINATA_FILE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
      body: imageUpload,
    });

    const imagePayload = (await imageResponse.json()) as PinataResponse;

    if (!imageResponse.ok || !imagePayload.IpfsHash) {
      throw new Error(
        imagePayload.error ||
          `Image upload failed with HTTP ${imageResponse.status}.`,
      );
    }

    const imageUrl = `${PUBLIC_GATEWAY}/${imagePayload.IpfsHash}`;
    const website = cleanOptionalUrl(incoming.get("website"));
    const twitter = cleanOptionalUrl(incoming.get("x"));
    const telegram = cleanOptionalUrl(incoming.get("telegram"));
    const discord = cleanOptionalUrl(incoming.get("discord"));

    const metadata = {
      name,
      symbol,
      description,
      image: imageUrl,
      external_url: website,
      attributes: [
        { trait_type: "Launchpad", value: "Kodiak" },
        { trait_type: "Network", value: "Solana Devnet" },
      ],
      properties: {
        category: "image",
        files: [{ uri: imageUrl, type: image.type || "image/png" }],
        creators: [],
      },
      extensions: { website, twitter, telegram, discord },
    };

    const metadataResponse = await fetch(PINATA_JSON_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pinataMetadata: { name: `${name} token metadata` },
        pinataContent: metadata,
      }),
    });

    const metadataPayload =
      (await metadataResponse.json()) as PinataResponse;

    if (!metadataResponse.ok || !metadataPayload.IpfsHash) {
      throw new Error(
        metadataPayload.error ||
          `Metadata upload failed with HTTP ${metadataResponse.status}.`,
      );
    }

    return NextResponse.json({
      uri: `${PUBLIC_GATEWAY}/${metadataPayload.IpfsHash}`,
      image: imageUrl,
      metadataCid: metadataPayload.IpfsHash,
      imageCid: imagePayload.IpfsHash,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to upload token metadata.",
      },
      { status: 500 },
    );
  }
}
EOF

python - <<'PY'
from pathlib import Path

path = Path("web/src/app/launch/page.tsx")
text = path.read_text()

old_imports = '''import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { KodiakWalletButton } from "@/components/wallet/KodiakWalletButton";'''
new_imports = '''import { ChangeEvent, useEffect, useMemo, useState } from "react";
import BN from "bn.js";
import {
  DEVNET_PROGRAM_ID,
  getPdaLaunchpadConfigId,
  LaunchpadConfig,
  TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { KodiakWalletButton } from "@/components/wallet/KodiakWalletButton";
import { loadDevnetRaydium } from "@/lib/raydium/devnet";'''
if old_imports not in text:
    raise SystemExit("Launch page imports were not recognized.")
text = text.replace(old_imports, new_imports)

old_wallet = '''  const { connected } = useWallet();'''
new_wallet = '''  const { connection } = useConnection();
  const { connected, publicKey, signAllTransactions } = useWallet();'''
if old_wallet not in text:
    raise SystemExit("Wallet hook was not recognized.")
text = text.replace(old_wallet, new_wallet)

old_state = '''  const [draftLoaded, setDraftLoaded] = useState(false);'''
new_state = '''  const [draftLoaded, setDraftLoaded] = useState(false);
  const [launchStatus, setLaunchStatus] = useState<
    | { kind: "idle"; message: string }
    | { kind: "working"; message: string }
    | { kind: "success"; message: string; mint: string; signatures: string[] }
    | { kind: "error"; message: string; logs?: string[] }
  >({ kind: "idle", message: "Ready to prepare a Devnet launch." });'''
if old_state not in text:
    raise SystemExit("Launch state insertion point was not recognized.")
text = text.replace(old_state, new_state)

old_clear = '''  const clearDraft = () => {
    window.localStorage.removeItem(storageKey);
    setForm(initialForm);
    setLogoPreview(null);
    setBannerPreview(null);
    setStep(0);
  };'''
new_clear = '''  const clearDraft = () => {
    window.localStorage.removeItem(storageKey);
    setForm(initialForm);
    setLogoPreview(null);
    setBannerPreview(null);
    setLaunchStatus({
      kind: "idle",
      message: "Ready to prepare a Devnet launch.",
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

  const prepareLaunchTransaction = async () => {
    if (!publicKey || !signAllTransactions) {
      setLaunchStatus({
        kind: "error",
        message: "Connect Phantom before preparing the launch.",
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
          "The first Devnet engine currently requires a supply of exactly 1,000,000,000 tokens.",
      });
      return;
    }

    const platformIdValue = window.localStorage.getItem(
      "kodiak-devnet-platform-id",
    );

    if (!platformIdValue) {
      setLaunchStatus({
        kind: "error",
        message:
          "Kodiak's Devnet PlatformConfig was not found in this browser. Open Platform Setup first.",
      });
      return;
    }

    try {
      const platformId = new PublicKey(platformIdValue);

      setLaunchStatus({
        kind: "working",
        message: "Uploading the token image and metadata to IPFS…",
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
        message: "Building the Raydium LaunchLab transaction…",
      });

      const programId = DEVNET_PROGRAM_ID.LAUNCHPAD_PROGRAM;
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
          `Raydium Devnet LaunchLab config was not found: ${configId.toBase58()}`,
        );
      }

      const configInfo = LaunchpadConfig.decode(configAccount.data);
      const mintKeypair = Keypair.generate();
      const raydium = await loadDevnetRaydium({
        connection,
        owner: publicKey,
        signAllTransactions,
      });

      const { transactions, execute } =
        await raydium.launchpad.createLaunchpad({
          programId,
          mintA: mintKeypair.publicKey,
          decimals: 6,
          name: form.name.trim(),
          symbol: form.symbol.replace("$", "").trim().toUpperCase(),
          migrateType: "cpmm",
          uri: metadataPayload.uri,
          configId,
          configInfo,
          mintBDecimals: 9,
          platformId,
          txVersion: TxVersion.V0,
          slippage: new BN(100),
          buyAmount: new BN(0),
          createOnly: true,
          extraSigners: [mintKeypair],
        });

      setLaunchStatus({
        kind: "working",
        message: "Simulating every Devnet launch transaction…",
      });

      for (let index = 0; index < transactions.length; index += 1) {
        const transaction = transactions[index];
        const simulation =
          transaction instanceof VersionedTransaction
            ? await connection.simulateTransaction(transaction, {
                commitment: "confirmed",
                replaceRecentBlockhash: true,
                sigVerify: false,
              })
            : await connection.simulateTransaction(transaction);

        if (simulation.value.err) {
          setLaunchStatus({
            kind: "error",
            message: `Launch simulation failed at transaction ${
              index + 1
            }: ${JSON.stringify(simulation.value.err)}`,
            logs: simulation.value.logs ?? [],
          });
          return;
        }
      }

      setLaunchStatus({
        kind: "working",
        message:
          "Simulation passed. Approve the Devnet launch transaction in Phantom…",
      });

      const sent = await execute({ sequentially: true });
      const signatures: string[] = [];

      const collectSignatures = (value: unknown) => {
        if (typeof value === "string") {
          signatures.push(value);
          return;
        }
        if (Array.isArray(value)) {
          value.forEach(collectSignatures);
          return;
        }
        if (typeof value === "object" && value !== null) {
          Object.entries(value).forEach(([key, item]) => {
            if (
              (key === "txId" || key === "signature" || key === "txid") &&
              typeof item === "string"
            ) {
              signatures.push(item);
            } else {
              collectSignatures(item);
            }
          });
        }
      };

      collectSignatures(sent);
      const mint = mintKeypair.publicKey.toBase58();
      const uniqueSignatures = Array.from(new Set(signatures));

      window.localStorage.setItem(
        "kodiak-last-devnet-launch",
        JSON.stringify({
          mint,
          signatures: uniqueSignatures,
          name: form.name,
          symbol: form.symbol,
          createdAt: new Date().toISOString(),
        }),
      );

      setLaunchStatus({
        kind: "success",
        message: "Token created through Kodiak on Solana Devnet.",
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

      setLaunchStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to prepare the Devnet launch.",
        logs,
      });
    }
  };'''
if old_clear not in text:
    raise SystemExit("Launch function insertion point was not recognized.")
text = text.replace(old_clear, new_clear)

old_button = '''                  <button
                    type="button"
                    className="w-full rounded-2xl bg-gradient-to-r from-emerald-400 to-amber-300 px-6 py-4 text-lg font-black text-black"
                  >
                    Prepare Launch Transaction
                  </button>'''
new_button = '''                  <div className="space-y-4">
                    <button
                      type="button"
                      onClick={() => void prepareLaunchTransaction()}
                      disabled={launchStatus.kind === "working"}
                      className="w-full rounded-2xl bg-gradient-to-r from-emerald-400 to-amber-300 px-6 py-4 text-lg font-black text-black disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {launchStatus.kind === "working"
                        ? "Preparing Devnet launch…"
                        : "Prepare Launch Transaction"}
                    </button>

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

                      {launchStatus.kind === "error" &&
                        launchStatus.logs &&
                        launchStatus.logs.length > 0 && (
                          <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/40 p-3 text-[11px] leading-5 text-zinc-300">
                            {launchStatus.logs.join("\\n")}
                          </pre>
                        )}

                      {launchStatus.kind === "success" && (
                        <div className="mt-4 space-y-3">
                          <div>
                            <p className="text-xs text-emerald-200/70">
                              Devnet mint
                            </p>
                            <p className="mt-1 break-all rounded-xl bg-black/30 p-3 font-mono text-xs">
                              {launchStatus.mint}
                            </p>
                          </div>
                          <a
                            href={`https://explorer.solana.com/address/${launchStatus.mint}?cluster=devnet`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block font-black text-amber-300"
                          >
                            View mint on Solana Explorer
                          </a>
                        </div>
                      )}
                    </div>
                  </div>'''
if old_button not in text:
    raise SystemExit("Prepare Launch Transaction button was not recognized.")
text = text.replace(old_button, new_button)

path.write_text(text)
PY

if ! grep -q '^PINATA_JWT=' web/.env.example 2>/dev/null; then
  {
    echo ""
    echo "# Server-only JWT used to upload public token images and metadata to IPFS."
    echo "PINATA_JWT="
  } >> web/.env.example
fi

cd web
npm run lint
npm run build
cd ..

git add web/src/app/launch/page.tsx web/src/app/api/launch-metadata/route.ts web/.env.example
git commit -m "wire Launch Wizard to Raydium Devnet token creation" || true
git push origin main

echo ""
echo "✅ Kodiak Devnet token launch engine installed and pushed."
echo ""
echo "Required before launching:"
echo "1. Create a Pinata API JWT with pinning permissions."
echo "2. Add it in Vercel as PINATA_JWT for Production, Preview, and Development."
echo "3. Redeploy Kodiak."
echo ""
echo "The launch button now uploads metadata, simulates the Raydium"
echo "LaunchLab transaction, asks Phantom to sign only after simulation"
echo "passes, and displays the Devnet mint address."
