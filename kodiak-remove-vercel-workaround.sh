#!/usr/bin/env bash
set -euo pipefail

echo "🐻 Removing the temporary Vercel root workaround..."

if [ ! -d "web" ]; then
  echo "Error: run this from /workspaces/Kodiak."
  exit 1
fi

rm -f vercel.json

git add -A
git commit -m "remove obsolete Vercel root deployment workaround" || true
git push origin main

echo ""
echo "✅ Temporary Vercel configuration removed."
echo "Keep Vercel Root Directory set to web, then redeploy."
