#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/Kodiak"
WEB="$ROOT/web"
CHART="$WEB/src/components/charts/LaunchChart.tsx"
LAUNCH="$WEB/src/app/launch/page.tsx"

echo "🐻 Fixing chart controls and mobile preview..."

for file in "$CHART" "$LAUNCH"; do
  if [ ! -f "$file" ]; then
    echo "Missing required file: $file"
    exit 1
  fi
done

cp "$CHART" "$CHART.bak-chart-toggle"
cp "$LAUNCH" "$LAUNCH.bak-preview-shading-v2"

python - <<'PY'
from pathlib import Path

chart_path = Path("/workspaces/Kodiak/web/src/components/charts/LaunchChart.tsx")
text = chart_path.read_text()

text = text.replace(
    'type Interval = "1s" | "1m" | "5m" | "15m" | "1h";',
    'type Interval = "1s" | "1m" | "5m" | "15m" | "1h";\ntype ChartMode = "candles" | "line";',
    1,
)

text = text.replace(
    'const [interval, setInterval] = useState<Interval>("1m");',
    'const [interval, setInterval] = useState<Interval>("1m");\n  const [chartMode, setChartMode] = useState<ChartMode>("candles");',
    1,
)

start = text.find('    if (candles.length > 0 && candles.length < 4) {')
end = text.find('    const volume = chart.addHistogramSeries', start)

if start == -1 or end == -1:
    raise SystemExit("Could not locate the current chart series block.")

replacement = '''    if (chartMode === "line") {
      const line = chart.addLineSeries({
        color: "#6ee7b7",
        lineWidth: 3,
        crosshairMarkerVisible: true,
        priceLineVisible: true,
        lastValueVisible: true,
        priceFormat: {
          type: "price",
          precision: 10,
          minMove: 0.0000000001,
        },
      });

      line.setData(
        normalized.map((candle) => ({
          time: candle.time,
          value: candle.close,
        })),
      );
    } else {
      const series = chart.addCandlestickSeries({
        upColor: "#39e58c",
        downColor: "#ff4d67",
        borderUpColor: "#39e58c",
        borderDownColor: "#ff4d67",
        wickUpColor: "#39e58c",
        wickDownColor: "#ff4d67",
        priceLineVisible: true,
        lastValueVisible: true,
        priceFormat: {
          type: "price",
          precision: 10,
          minMove: 0.0000000001,
        },
      });

      series.setData(normalized);

      const markers = trades
        .filter((trade) => Number.isFinite(trade.timestamp))
        .slice(0, 100)
        .reverse()
        .map((trade) => ({
          time: trade.timestamp as UTCTimestamp,
          position:
            trade.side === "buy"
              ? ("belowBar" as const)
              : ("aboveBar" as const),
          color: trade.side === "buy" ? "#39e58c" : "#ff4d67",
          shape:
            trade.side === "buy"
              ? ("arrowUp" as const)
              : ("arrowDown" as const),
          text: `${trade.side === "buy" ? "BUY" : "SELL"} ${formatSol(
            trade.solAmount,
          )} SOL`,
        }));

      if (markers.length && "setMarkers" in series) {
        series.setMarkers(markers);
      }
    }

'''

text = text[:start] + replacement + text[end:]

text = text.replace(
    '}, [candles, interval, trades]);',
    '}, [candles, chartMode, interval, trades]);',
    1,
)

needle = '''        <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
          {INTERVALS.map((value) => ('''

replacement_ui = '''        <div className="flex flex-col items-end gap-2">
          <div className="flex rounded-xl border border-white/10 p-1">
            <button
              type="button"
              onClick={() => setChartMode("candles")}
              className={`rounded-lg px-3 py-2 text-xs font-black ${
                chartMode === "candles"
                  ? "bg-white text-black"
                  : "text-zinc-400"
              }`}
            >
              Candles
            </button>
            <button
              type="button"
              onClick={() => setChartMode("line")}
              className={`rounded-lg px-3 py-2 text-xs font-black ${
                chartMode === "line"
                  ? "bg-white text-black"
                  : "text-zinc-400"
              }`}
            >
              Line
            </button>
          </div>

          <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
          {INTERVALS.map((value) => ('''

if needle not in text:
    raise SystemExit("Could not locate the timeframe controls.")

text = text.replace(needle, replacement_ui, 1)

needle_close = '''          ))}
        </div>
      </div>

      <div
        ref={containerRef}'''

replacement_close = '''          ))}
          </div>
        </div>
      </div>

      <div
        ref={containerRef}'''

if needle_close not in text:
    raise SystemExit("Could not close the chart controls wrapper.")

text = text.replace(needle_close, replacement_close, 1)

text = text.replace(
    '''          } else if (nextCandles.length < 4) {
            setMessage(
              `${nextCandles.length} price point${nextCandles.length === 1 ? "" : "s"} loaded · sparse-trading mode`,
            );
          } else {''',
    '''          } else {''',
    1,
)

chart_path.write_text(text)

launch_path = Path("/workspaces/Kodiak/web/src/app/launch/page.tsx")
launch = launch_path.read_text()

old_banner = '''          <div className="relative h-20 sm:h-36 bg-gradient-to-br from-amber-300/10 via-zinc-950 to-emerald-400/5">
            {bannerPreview && (
              <img src={bannerPreview} alt="Token banner preview" className="h-full w-full object-cover" />
            )}
          </div>'''

new_banner = '''          {bannerPreview ? (
            <div className="relative h-24 overflow-hidden sm:h-36">
              <img
                src={bannerPreview}
                alt="Token banner preview"
                className="h-full w-full object-cover"
              />
            </div>
          ) : null}'''

if old_banner not in launch:
    raise SystemExit("Could not locate the mobile preview banner block.")

launch = launch.replace(old_banner, new_banner, 1)

launch = launch.replace(
    'className="-mt-10 flex items-end justify-between sm:-mt-14"',
    'className={`flex items-end justify-between ${bannerPreview ? "-mt-10 sm:-mt-14" : "mt-0"}`}',
    1,
)

launch_path.write_text(launch)
PY

cd "$WEB"
npm run lint
npm run build

cd "$ROOT"
git add web/src/components/charts/LaunchChart.tsx web/src/app/launch/page.tsx
git commit -m "add chart type toggle and remove empty preview shading" || true
git push origin main

echo ""
echo "✅ Fix completed and pushed."
echo "Candlesticks are now the default, with a Line/Candles selector."
echo "The empty shaded preview header is removed when no banner is selected."
