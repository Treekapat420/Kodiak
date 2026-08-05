"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  CrosshairMode,
  createChart,
  type BarData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

type Interval = "1s" | "1m" | "5m" | "15m" | "1h";
type ChartMode = "candles" | "line";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

type Trade = {
  wallet: string;
  signature: string;
  side: "buy" | "sell";
  solAmount: number;
  tokenAmount: number;
  priceSol: number;
  timestamp: number;
};

type ChartPayload = { candles?: Candle[]; error?: string };
type TradesPayload = { trades?: Trade[]; error?: string };
type HoverData = { time: number; open: number; high: number; low: number; close: number };

const INTERVALS: Interval[] = ["1s", "1m", "5m", "15m", "1h"];

function toTimestamp(value: number) {
  return value as UTCTimestamp;
}

function shortWallet(wallet: string) {
  return wallet ? `${wallet.slice(0, 4)}...${wallet.slice(-4)}` : "-";
}

function formatSol(value: number) {
  if (!Number.isFinite(value) || value === 0) return "0";
  if (Math.abs(value) >= 1) return value.toFixed(4);
  if (Math.abs(value) >= 0.001) return value.toFixed(6);
  return value.toPrecision(6);
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "0.00%";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function sameCandle(left: Candle, right: Candle) {
  return (
    left.time === right.time &&
    left.open === right.open &&
    left.high === right.high &&
    left.low === right.low &&
    left.close === right.close &&
    Number(left.volume ?? 0) === Number(right.volume ?? 0)
  );
}

export function LaunchChart({ mint }: { mint: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const previousCandlesRef = useRef<Candle[]>([]);
  const initialFitRef = useRef(false);

  const [interval, setInterval] = useState<Interval>("1m");
  const [chartMode, setChartMode] = useState<ChartMode>("candles");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [hover, setHover] = useState<HoverData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState("Loading Kodiak market data...");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [chartResponse, tradesResponse] = await Promise.all([
          fetch(`/api/token/${encodeURIComponent(mint)}/chart?interval=${interval}`, { cache: "no-store" }),
          fetch(`/api/token/${encodeURIComponent(mint)}/trades`, { cache: "no-store" }),
        ]);

        const chartPayload = (await chartResponse.json()) as ChartPayload;
        const tradesPayload = (await tradesResponse.json()) as TradesPayload;

        if (!chartResponse.ok) throw new Error(chartPayload.error || "Unable to load chart.");
        if (!tradesResponse.ok) throw new Error(tradesPayload.error || "Unable to load trades.");
        if (cancelled) return;

        const nextCandles = chartPayload.candles ?? [];
        const nextTrades = tradesPayload.trades ?? [];

        setCandles(nextCandles);
        setTrades(nextTrades);
        setLoading(false);
        setMessage(
          nextCandles.length === 0
            ? "No trades yet. The first completed trade will begin the chart."
            : `${nextCandles.length} candle${nextCandles.length === 1 ? "" : "s"} loaded | updates every 3 seconds`,
        );
      } catch (error) {
        if (!cancelled) {
          setLoading(false);
          setMessage(error instanceof Error ? error.message : "Unable to load chart.");
        }
      }
    };

    setLoading(true);
    setHover(null);
    initialFitRef.current = false;
    previousCandlesRef.current = [];

    void load();
    const timer = window.setInterval(() => void load(), 3_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [interval, mint]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: expanded ? Math.max(window.innerHeight - 185, 420) : 460,
      layout: {
        background: { type: ColorType.Solid, color: "#070707" },
        textColor: "#a1a1aa",
        fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
      },
      localization: { priceFormatter: formatSol },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.045)" },
        horzLines: { color: "rgba(255,255,255,0.045)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(110,231,183,0.40)", width: 1, style: 2, labelBackgroundColor: "#15231d" },
        horzLine: { color: "rgba(110,231,183,0.40)", width: 1, style: 2, labelBackgroundColor: "#15231d" },
      },
      rightPriceScale: {
        visible: true,
        autoScale: true,
        borderVisible: true,
        borderColor: "rgba(255,255,255,0.12)",
        entireTextOnly: true,
        scaleMargins: { top: 0.08, bottom: 0.25 },
      },
      leftPriceScale: { visible: false },
      timeScale: {
        visible: true,
        timeVisible: true,
        secondsVisible: interval === "1s",
        borderVisible: true,
        borderColor: "rgba(255,255,255,0.12)",
        rightOffset: 5,
        barSpacing: 9,
        minBarSpacing: 1,
        fixLeftEdge: false,
        fixRightEdge: false,
        lockVisibleTimeRangeOnResize: true,
        rightBarStaysOnScroll: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      kineticScroll: { mouse: true, touch: true },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#39e58c",
      downColor: "#ff4d67",
      borderVisible: false,
      wickVisible: true,
      wickUpColor: "#39e58c",
      wickDownColor: "#ff4d67",
      priceLineVisible: true,
      lastValueVisible: true,
      priceFormat: { type: "price", precision: 10, minMove: 0.0000000001 },
      visible: chartMode === "candles",
    });

    const lineSeries = chart.addLineSeries({
      color: "#6ee7b7",
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      priceLineVisible: true,
      lastValueVisible: true,
      priceFormat: { type: "price", precision: 10, minMove: 0.0000000001 },
      visible: chartMode === "line",
    });

    const volumeSeries = chart.addHistogramSeries({
      priceScaleId: "",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });

    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.80, bottom: 0 } });

    const handleCrosshair = (param: MouseEventParams<Time>) => {
      if (!param.time) {
        setHover(null);
        return;
      }

      const data = param.seriesData.get(candleSeries);
      if (data && "open" in data && "high" in data && "low" in data && "close" in data) {
        setHover({
          time: Number(param.time),
          open: Number(data.open),
          high: Number(data.high),
          low: Number(data.low),
          close: Number(data.close),
        });
      }
    };

    chart.subscribeCrosshairMove(handleCrosshair);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    lineSeriesRef.current = lineSeries;
    volumeSeriesRef.current = volumeSeries;
    initialFitRef.current = false;
    previousCandlesRef.current = [];

    const resize = () => {
      const current = containerRef.current;
      if (!current) return;
      chart.applyOptions({
        width: current.clientWidth,
        height: expanded ? Math.max(window.innerHeight - 185, 420) : 460,
      });
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    window.addEventListener("orientationchange", resize);
    window.addEventListener("resize", resize);

    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", resize);
      window.removeEventListener("resize", resize);
      chart.unsubscribeCrosshairMove(handleCrosshair);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [expanded, interval]);

  useEffect(() => {
    candleSeriesRef.current?.applyOptions({ visible: chartMode === "candles" });
    lineSeriesRef.current?.applyOptions({ visible: chartMode === "line" });
  }, [chartMode]);

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const lineSeries = lineSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const chart = chartRef.current;
    if (!candleSeries || !lineSeries || !volumeSeries || !chart) return;

    const candleData: BarData[] = candles.map((candle) => ({
      time: toTimestamp(candle.time),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));

    const lineData: LineData[] = candles.map((candle) => ({
      time: toTimestamp(candle.time),
      value: candle.close,
    }));

    const volumeData: HistogramData[] = candles.map((candle) => ({
      time: toTimestamp(candle.time),
      value: Number(candle.volume ?? 0),
      color: candle.close >= candle.open ? "rgba(57,229,140,0.38)" : "rgba(255,77,103,0.38)",
    }));

    const previous = previousCandlesRef.current;
    const onlyLatestChanged =
      previous.length > 0 &&
      candles.length >= previous.length &&
      candles.length <= previous.length + 1 &&
      previous.slice(0, -1).every((oldCandle, index) => sameCandle(oldCandle, candles[index]));

    if (onlyLatestChanged && candles.length > 0) {
      candleSeries.update(candleData[candleData.length - 1]);
      lineSeries.update(lineData[lineData.length - 1]);
      volumeSeries.update(volumeData[volumeData.length - 1]);
    } else {
      candleSeries.setData(candleData);
      lineSeries.setData(lineData);
      volumeSeries.setData(volumeData);
    }

    previousCandlesRef.current = candles.map((candle) => ({ ...candle }));

    if (!initialFitRef.current && candles.length > 0) {
      chart.timeScale().fitContent();
      if (candles.length <= 3) {
        chart.timeScale().applyOptions({
          barSpacing: expanded ? 38 : 28,
          rightOffset: expanded ? 8 : 5,
        });
      }
      initialFitRef.current = true;
    }
  }, [candles, expanded]);

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [expanded]);

  const metrics = useMemo(() => {
    const first = candles[0];
    const latest = candles.at(-1);
    const latestPrice = latest?.close ?? 0;
    const startPrice = first?.open ?? latestPrice;

    return {
      latestPrice,
      changePercent: startPrice > 0 ? ((latestPrice - startPrice) / startPrice) * 100 : 0,
      high: candles.reduce((highest, candle) => Math.max(highest, candle.high), 0),
      low:
        candles.length > 0
          ? candles.reduce((lowest, candle) => Math.min(lowest, candle.low), candles[0].low)
          : 0,
    };
  }, [candles]);

  const resetChart = () => {
    const chart = chartRef.current;
    if (!chart || candles.length === 0) return;
    chart.timeScale().applyOptions({
      barSpacing: candles.length <= 3 ? (expanded ? 38 : 28) : 9,
      rightOffset: expanded ? 8 : 5,
    });
    chart.timeScale().fitContent();
    chart.priceScale("right").applyOptions({ autoScale: true });
  };

  const display = hover ?? {
    time: candles.at(-1)?.time ?? 0,
    open: candles.at(-1)?.open ?? 0,
    high: candles.at(-1)?.high ?? 0,
    low: candles.at(-1)?.low ?? 0,
    close: candles.at(-1)?.close ?? 0,
  };

  return (
    <section
      className={
        expanded
          ? "fixed inset-0 z-[100] flex flex-col bg-[#070707] p-3 text-white"
          : "rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-6"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">Live market</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-black">Price chart</h2>
            {metrics.latestPrice > 0 && (
              <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-300">
                {formatSol(metrics.latestPrice)} SOL
              </span>
            )}
            {candles.length > 1 && (
              <span
                className={`rounded-full px-3 py-1 text-xs font-black ${
                  metrics.changePercent >= 0
                    ? "bg-emerald-400/10 text-emerald-300"
                    : "bg-rose-400/10 text-rose-300"
                }`}
              >
                {formatPercent(metrics.changePercent)}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="flex rounded-xl border border-white/10 p-1">
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

          <button
            type="button"
            onClick={resetChart}
            className="rounded-xl border border-white/10 px-3 py-2 text-xs font-black text-zinc-300"
          >
            Reset
          </button>

          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-black text-emerald-300"
          >
            {expanded ? "Close" : "Expand"}
          </button>
        </div>
      </div>

      <div className="mt-3 flex max-w-full gap-2 overflow-x-auto pb-1">
        {INTERVALS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setInterval(value)}
            className={`shrink-0 rounded-xl px-4 py-2 text-sm font-black ${
              interval === value
                ? "bg-emerald-400 text-black"
                : "border border-white/10 text-zinc-300"
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold text-zinc-400">
        <span>O {formatSol(display.open)}</span>
        <span>H {formatSol(display.high)}</span>
        <span>L {formatSol(display.low)}</span>
        <span>C {formatSol(display.close)}</span>
      </div>

      <div
        className={`relative mt-3 overflow-hidden rounded-2xl border border-white/10 bg-[#070707] ${
          expanded ? "min-h-0 flex-1" : ""
        }`}
      >
        <div
          ref={containerRef}
          className={expanded ? "h-full w-full" : "min-h-[460px] w-full"}
          style={{
            touchAction: expanded ? "none" : "pan-y",
            overscrollBehavior: "contain",
          }}
        />

        {loading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="rounded-xl border border-white/10 bg-black/80 px-4 py-3 text-sm font-bold text-zinc-300">
              Loading chart...
            </div>
          </div>
        )}

        {!loading && candles.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-sm rounded-2xl border border-dashed border-white/10 bg-black/70 p-6 text-center">
              <p className="font-black text-white">No chart data yet</p>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                The first completed trade will create the first price candle.
              </p>
            </div>
          </div>
        )}
      </div>

      {!expanded && (
        <>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
            <p>{message}</p>
            <p>
              {trades.length} recorded trade{trades.length === 1 ? "" : "s"}
            </p>
          </div>

          {trades.length > 0 && (
            <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
              <div className="border-b border-white/10 px-4 py-3 text-sm font-black">Recent trades</div>
              <div className="divide-y divide-white/5">
                {trades.slice(0, 8).map((trade) => (
                  <a
                    key={trade.signature}
                    href={`https://explorer.solana.com/tx/${trade.signature}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                    className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 text-xs transition hover:bg-white/[0.03]"
                  >
                    <span
                      className={`rounded-full px-2 py-1 font-black ${
                        trade.side === "buy"
                          ? "bg-emerald-400/10 text-emerald-300"
                          : "bg-rose-400/10 text-rose-300"
                      }`}
                    >
                      {trade.side.toUpperCase()}
                    </span>
                    <span className="truncate text-zinc-400">{shortWallet(trade.wallet)}</span>
                    <span className="font-bold text-zinc-200">{formatSol(trade.solAmount)} SOL</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
