#!/usr/bin/env bash
set -euo pipefail

echo "🐻 Configuring Vercel to deploy Kodiak from the web folder..."

if [ ! -d "web" ]; then
  echo "Error: run this from /workspaces/Kodiak."
  exit 1
fi

cat > vercel.json <<'EOF'
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "installCommand": "cd web && npm install",
  "buildCommand": "cd web && npm run build",
  "outputDirectory": "web/.next"
}
EOF

git add vercel.json
git commit -m "configure Vercel deployment from web directory" || true
git push origin main

echo ""
echo "✅ Vercel configuration pushed."
echo "In Vercel, leave Root Directory as Kodiak (root), then deploy or redeploy."
