#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/Kodiak"
WEB="$ROOT/web"
CHART="$WEB/src/components/charts/LaunchChart.tsx"
LAUNCH="$WEB/src/app/launch/page.tsx"

echo "🐻 Applying corrected chart selector and preview fix..."

cp "$CHART" "$CHART.bak-chart-toggle-v3"
cp "$LAUNCH" "$LAUNCH.bak-preview-v3"

python - <<'PY'
from pathlib import Path
import re

chart = Path('/workspaces/Kodiak/web/src/components/charts/LaunchChart.tsx')
text = chart.read_text()

if 'type ChartMode = "candles" | "line";' not in text:
    text = text.replace(
        'type Interval = "1s" | "1m" | "5m" | "15m" | "1h";',
        'type Interval = "1s" | "1m" | "5m" | "15m" | "1h";\ntype ChartMode = "candles" | "line";',
        1,
    )

if 'const [chartMode, setChartMode]' not in text:
    text = text.replace(
        'const [interval, setInterval] = useState<Interval>("1m");',
        'const [interval, setInterval] = useState<Interval>("1m");\n  const [chartMode, setChartMode] = useState<ChartMode>("candles");',
        1,
    )

text = text.replace(
    'if (candles.length > 0 && candles.length < 4) {',
    'if (chartMode === "line") {',
    1,
)

text = text.replace(
    '}, [candles, interval, trades]);',
    '}, [candles, chartMode, interval, trades]);',
    1,
)

text = text.replace(
'''          } else if (nextCandles.length < 4) {
            setMessage(
              `${nextCandles.length} price point${nextCandles.length === 1 ? "" : "s"} loaded · sparse-trading mode`,
            );
          } else {''',
'''          } else {''',
    1,
)

if 'onClick={() => setChartMode("candles")}' not in text:
    marker = '        <div className="flex max-w-full gap-2 overflow-x-auto pb-1">\n          {INTERVALS.map((value) => ('
    toggle = '''        <div className="flex rounded-xl border border-white/10 p-1">
          <button
            type="button"
            onClick={() => setChartMode("candles")}
            className={`rounded-lg px-3 py-2 text-xs font-black ${
              chartMode === "candles" ? "bg-white text-black" : "text-zinc-400"
            }`}
          >
            Candles
          </button>
          <button
            type="button"
            onClick={() => setChartMode("line")}
            className={`rounded-lg px-3 py-2 text-xs font-black ${
              chartMode === "line" ? "bg-white text-black" : "text-zinc-400"
            }`}
          >
            Line
          </button>
        </div>

        <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
          {INTERVALS.map((value) => ('''
    if marker not in text:
        raise SystemExit('Could not locate timeframe controls.')
    text = text.replace(marker, toggle, 1)

chart.write_text(text)

launch = Path('/workspaces/Kodiak/web/src/app/launch/page.tsx')
text = launch.read_text()

pattern = re.compile(
    r'<div className="relative h-(?:20|36)(?: sm:h-36)? bg-gradient-to-br[^\"]*">\s*'
    r'\{bannerPreview && \(\s*'
    r'<img src=\{bannerPreview\} alt="Token banner preview" className="h-full w-full object-cover" />\s*'
    r'\)\}\s*</div>',
    re.S,
)

replacement = '''{bannerPreview ? (
            <div className="relative h-24 overflow-hidden sm:h-36">
              <img
                src={bannerPreview}
                alt="Token banner preview"
                className="h-full w-full object-cover"
              />
            </div>
          ) : null}'''

text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit('Could not locate the preview banner block.')

text = text.replace(
    'className="-mt-10 flex items-end justify-between sm:-mt-14"',
    'className={`flex items-end justify-between ${bannerPreview ? "-mt-10 sm:-mt-14" : "mt-0"}`}',
    1,
)

launch.write_text(text)
PY

cd "$WEB"
npm run lint
npm run build

cd "$ROOT"
git add web/src/components/charts/LaunchChart.tsx web/src/app/launch/page.tsx
git commit -m "fix chart selector and mobile preview shading" || true
git push origin main

echo ""
echo "✅ Done. Candles are default, Line is optional, and empty preview shading is removed."
