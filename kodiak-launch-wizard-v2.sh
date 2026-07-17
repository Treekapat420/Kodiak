#!/usr/bin/env bash
set -euo pipefail

echo "🐻 Installing Kodiak Launch Wizard v2..."

if [ ! -d "web" ]; then
  echo "Error: run this from /workspaces/Kodiak."
  exit 1
fi

cat > web/src/app/launch/page.tsx <<'EOF'
"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { KodiakWalletButton } from "@/components/wallet/KodiakWalletButton";

type FormState = {
  name: string;
  symbol: string;
  description: string;
  x: string;
  telegram: string;
  website: string;
  discord: string;
  supply: string;
  lpHandling: "burn" | "lock" | "keep";
  postMigrationFee: boolean;
};

const steps = ["Project", "Branding", "Socials", "Launch", "Review"];
const storageKey = "kodiak-launch-draft-v2";

const initialForm: FormState = {
  name: "",
  symbol: "",
  description: "",
  x: "",
  telegram: "",
  website: "",
  discord: "",
  supply: "1000000000",
  lpHandling: "burn",
  postMigrationFee: true,
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
  const { connected } = useWallet();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(initialForm);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);

  useEffect(() => {
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

  const estimatedCost = "≈ 0.02 SOL + network fees";

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
    setStep(0);
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

                <div>
                  <p className="mb-3 text-sm font-bold text-zinc-300">LP handling</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {(["burn", "lock", "keep"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => update("lpHandling", option)}
                        className={`rounded-2xl border px-4 py-4 text-left font-bold capitalize ${
                          form.lpHandling === option
                            ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                            : "border-white/10 bg-white/[0.03] text-zinc-400"
                        }`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <input
                    type="checkbox"
                    checked={form.postMigrationFee}
                    onChange={(event) => update("postMigrationFee", event.target.checked)}
                    className="mt-1 h-5 w-5 accent-emerald-400"
                  />
                  <span>
                    <span className="block font-black">Enable 1.05% post-migration creator fee</span>
                    <span className="mt-1 block text-sm leading-6 text-zinc-500">
                      Optional Token-2022 transfer fee after graduation.
                    </span>
                  </span>
                </label>

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
                    ["LP handling", form.lpHandling],
                    ["Bonding creator fee", "0.45%"],
                    ["Post-migration fee", form.postMigrationFee ? "1.05% enabled" : "Disabled"],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-5 border-b border-white/5 pb-3 last:border-0 last:pb-0">
                      <span className="text-zinc-500">{label}</span>
                      <span className="text-right font-bold capitalize">{value}</span>
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
                  <button
                    type="button"
                    className="w-full rounded-2xl bg-gradient-to-r from-emerald-400 to-amber-300 px-6 py-4 text-lg font-black text-black"
                  >
                    Prepare Launch Transaction
                  </button>
                )}
              </div>
            )}
          </section>

          <aside className="space-y-5 xl:sticky xl:top-6 xl:self-start">
            <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950">
              <div className="relative h-36 bg-gradient-to-br from-amber-300/20 via-zinc-900 to-emerald-400/10">
                {bannerPreview && (
                  <img src={bannerPreview} alt="Token banner preview" className="h-full w-full object-cover" />
                )}
              </div>

              <div className="p-6">
                <div className="-mt-14 flex items-end justify-between">
                  <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-3xl border-4 border-zinc-950 bg-gradient-to-br from-amber-300 to-orange-500 text-2xl font-black text-black">
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
                      {item.complete ? "✓" : "·"}
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
                if (stepValid) setStep((current) => Math.min(current + 1, 4));
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
EOF

cd web
npm run lint
npm run build
cd ..

git add web/src/app/launch/page.tsx
git commit -m "add launch score autosave and desktop polish" || true

echo ""
echo "✅ Kodiak Launch Wizard v2 installed."
echo "Refresh Kodiak and open Launch."
