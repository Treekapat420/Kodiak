#!/usr/bin/env bash
set -euo pipefail

echo "🐻 Installing Kodiak Launch Wizard..."

mkdir -p web/src/app/launch

cat > web/src/app/launch/page.tsx <<'EOF'
"use client";

import { useState } from "react";

const steps = ["Project","Branding","Socials","Launch","Review"];

export default function LaunchPage() {
  const [step,setStep]=useState(0);

  return (
    <main className="mx-auto max-w-3xl p-6 text-white">
      <h1 className="text-4xl font-bold mb-2">Launch Wizard</h1>
      <p className="text-zinc-400 mb-8">Build your Solana launch in five simple steps.</p>

      <div className="grid grid-cols-5 gap-2 mb-8">
        {steps.map((s,i)=>(
          <div key={s}
            className={`rounded-xl p-3 text-center text-sm font-semibold ${
              i===step ? "bg-emerald-500 text-black":"bg-zinc-900 text-zinc-400"
            }`}>
            {s}
          </div>
        ))}
      </div>

      {step===0 && (
        <div className="space-y-4">
          <input className="w-full rounded-xl bg-zinc-900 p-4" placeholder="Token Name"/>
          <input className="w-full rounded-xl bg-zinc-900 p-4" placeholder="Symbol"/>
          <textarea className="w-full rounded-xl bg-zinc-900 p-4" rows={5} placeholder="Description"/>
        </div>
      )}

      {step===1 && <div className="rounded-xl border border-dashed border-zinc-600 p-10 text-center">Logo & Banner upload (coming next)</div>}
      {step===2 && <div className="space-y-4">
        <input className="w-full rounded-xl bg-zinc-900 p-4" placeholder="X / Twitter"/>
        <input className="w-full rounded-xl bg-zinc-900 p-4" placeholder="Telegram"/>
        <input className="w-full rounded-xl bg-zinc-900 p-4" placeholder="Website"/>
      </div>}
      {step===3 && <div className="space-y-4">
        <input className="w-full rounded-xl bg-zinc-900 p-4" defaultValue="1,000,000,000"/>
        <div className="rounded-xl bg-zinc-900 p-4">Creator fee model: 0.45% bonding • 1.05% post migration</div>
      </div>}
      {step===4 && <div className="rounded-xl bg-zinc-900 p-6">
        <h2 className="text-2xl font-bold mb-3">Review</h2>
        <p className="text-zinc-400">Next sprint this button will create a real Raydium LaunchLab token.</p>
        <button className="mt-6 w-full rounded-xl bg-emerald-500 py-4 font-bold text-black">
          Launch Token
        </button>
      </div>}

      <div className="mt-8 flex justify-between">
        <button disabled={step===0}
          onClick={()=>setStep(step-1)}
          className="rounded-xl bg-zinc-800 px-6 py-3 disabled:opacity-40">
          Back
        </button>

        <button
          onClick={()=>setStep(Math.min(step+1,4))}
          className="rounded-xl bg-emerald-500 px-6 py-3 font-bold text-black">
          {step===4?"Done":"Next"}
        </button>
      </div>
    </main>
  );
}
EOF

cd web
npm run build
cd ..

git add web/src/app/launch/page.tsx
git commit -m "launch wizard v1" || true

echo "✅ Launch Wizard installed."
