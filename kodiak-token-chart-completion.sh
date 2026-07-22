#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/Kodiak"
WEB="$ROOT/web"
CREATOR="$WEB/src/app/creator/page.tsx"

echo "🐻 Finishing Kodiak token chart integration..."

for file in   "$CREATOR"   "$WEB/src/app/token/[mint]/page.tsx"   "$WEB/src/app/api/token/[mint]/chart/route.ts"   "$WEB/src/components/charts/LaunchChart.tsx"
do
  if [ ! -f "$file" ]; then
    echo "Error: missing $file"
    exit 1
  fi
done

python - <<'PY'
from pathlib import Path
import re

path = Path("/workspaces/Kodiak/web/src/app/creator/page.tsx")
text = path.read_text()

pattern = re.compile(
    r'<a\s+href=\{`https://explorer\.solana\.com/address/\$\{launch\.mint\}\?cluster=devnet`\}'
    r'\s+target="_blank"\s+rel="noreferrer"\s+className="([^"]+)"\s*>'
    r'\s*View token\s*</a>',
    re.S,
)

replacement = '''<a
                        href={`/token/${launch.mint}`}
                        className="\\1"
                      >
                        View token + chart
                      </a>'''

updated, count = pattern.subn(replacement, text, count=1)

if count != 1:
    raise SystemExit("Current View token link was not recognized.")

updated = updated.replace(
    'href="/trade"',
    'href={`/trade?mint=${encodeURIComponent(launch.mint)}`}',
    1,
)

path.write_text(updated)
PY

cd "$WEB"
npm run lint
npm run build

cd "$ROOT"
git add web/package.json web/package-lock.json web/src/app/token web/src/app/api/token web/src/components/charts/LaunchChart.tsx web/src/app/creator/page.tsx
git commit -m "finish token pages and chart integration" || true
git push origin main

echo ""
echo "✅ Token pages and charts completed and pushed."
echo "After Vercel is Ready, open /creator and tap View token + chart."
