"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
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

type ChartPayload = {
  candles?: Candle[];
  error?: string;
};

type TradesPayload = {
  trades?: Trade[];
  error?: string;
};

const INTERVALS: Interval[] = ["1s", "1m", "5m", "15m", "1h"];

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

function toChartTime(time: number) {
  return time as UTCTimestamp;
}

export function LaunchChart({ mint }: { mint: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const firstDataLoadRef = useRef(true);
  const previousCandlesRef = useRef<Candle[]>([]);

  const [interval, setInterval] = useState<Interval>("1m");
  const [chartMode, setChartMode] = useState<ChartMode>("candles");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("Loading Kodiak market data...");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [chartResponse, tradesResponse] = await Promise.all([
          fetch(
            `/api/token/${encodeURIComponent(mint)}/chart?interval=${interval}`,
            { cache: "no-store" },
          ),
          fetch(`/api/token/${encodeURIComponent(mint)}/trades`, {
            cache: "no-store",
          }),
        ]);

        const chartPayload = (await chartResponse.json()) as ChartPayload;
        const tradesPayload = (await tradesResponse.json()) as TradesPayload;

        if (!chartResponse.ok) {
          throw new Error(chartPayload.error || "Unable to load chart.");
        }

        if (!tradesResponse.ok) {
          throw new Error(tradesPayload.error || "Unable to load trades.");
        }

        if (cancelled) return;

        const nextCandles = chartPayload.candles ?? [];
        const nextTrades = tradesPayload.trades ?? [];

        setCandles(nextCandles);
        setTrades(nextTrades);
        setLoading(false);

        setMessage(
          nextCandles.length === 0
            ? "No trades yet. The first Kodiak trade will begin the chart."
            : `${nextCandles.length} candles loaded | updates every 3 seconds`,
        );
      } catch (error) {
        if (!cancelled) {
          setLoading(false);
          setMessage(
            error instanceof Error ? error.message : "Unable to load chart.",
          );
        }
      }
    };

    setLoading(true);
    firstDataLoadRef.current = true;
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
      height: 460,
      layout: {
        background: {
          type: ColorType.Solid,
          color: "#070707",
        },
        textColor: "#a1a1aa",
      },
      grid: {
        vertLines: {
          color: "rgba(255,255,255,0.04)",
        },
        horzLines: {
          color: "rgba(255,255,255,0.04)",
        },
      },
      crosshair: {
        vertLine: {
          color: "rgba(110,231,183,0.35)",
          labelBackgroundColor: "#111827",
        },
        horzLine: {
          color: "rgba(110,231,183,0.35)",
          labelBackgroundColor: "#111827",
        },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.10)",
        scaleMargins: {
          top: 0.08,
          bottom: 0.25,
        },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.10)",
        timeVisible: true,
        secondsVisible: interval === "1s",
        rightOffset: 6,
        barSpacing: 8,
        minBarSpacing: 2,
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
      kineticScroll: {
        mouse: true,
        touch: true,
      },
    });

    if (chartMode === "candles") {
      candleSeriesRef.current = chart.addCandlestickSeries({
        upColor: "#39e58c",
        downColor: "#ff4d67",
        borderVisible: false,
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
    } else {
      lineSeriesRef.current = chart.addLineSeries({
        color: "#6ee7b7",
        lineWidth: 2,
        crosshairMarkerVisible: true,
        priceLineVisible: true,
        lastValueVisible: true,
        priceFormat: {
          type: "price",
          precision: 10,
          minMove: 0.0000000001,
        },
      });
    }

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: {
        type: "volume",
      },
      priceScaleId: "",
      lastValueVisible: false,
      priceLineVisible: false,
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.80,
        bottom: 0,
      },
    });

    chartRef.current = chart;
    volumeSeriesRef.current = volumeSeries;
    firstDataLoadRef.current = true;
    previousCandlesRef.current = [];

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({
        width: container.clientWidth,
      });
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();

      chartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
      volumeSeriesRef.current = null;
      previousCandlesRef.current = [];
    };
  }, [chartMode, interval]);

  useEffect(() => {
    const chart = chartRef.current;
    const volumeSeries = volumeSeriesRef.current;

    if (!chart || !volumeSeries) return;

    const normalized = candles.map((candle) => ({
      ...candle,
      time: toChartTime(candle.time),
    }));

    const previous = previousCandlesRef.current;
    const canUpdateOnlyLatest =
      previous.length > 0 &&
      normalized.length >= previous.length &&
      normalized.length <= previous.length + 1 &&
      previous.slice(0, -1).every((oldCandle, index) => {
        const next = candles[index];
        return (
          next &&
          oldCandle.time === next.time &&
          oldCandle.open === next.open &&
          oldCandle.high === next.high &&
          oldCandle.low === next.low &&
          oldCandle.close === next.close &&
          Number(oldCandle.volume ?? 0) === Number(next.volume ?? 0)
        );
      });

    if (chartMode === "candles") {
      const series = candleSeriesRef.current;
      if (!series) return;

      if (canUpdateOnlyLatest && normalized.length > 0) {
        const latest = normalized[normalized.length - 1];
        series.update(latest);
      } else {
        series.setData(normalized);
      }
    } else {
      const series = lineSeriesRef.current;
      if (!series) return;

      const lineData = normalized.map((candle) => ({
        time: candle.time,
        value: candle.close,
      }));

      if (canUpdateOnlyLatest && lineData.length > 0) {
        series.update(lineData[lineData.length - 1]);
      } else {
        series.setData(lineData);
      }
    }

    const volumeData = normalized.map((candle) => ({
      time: candle.time,
      value: Number(candle.volume ?? 0),
      color:
        candle.close >= candle.open
          ? "rgba(57,229,140,0.35)"
          : "rgba(255,77,103,0.35)",
    }));

    if (canUpdateOnlyLatest && volumeData.length > 0) {
      volumeSeries.update(volumeData[volumeData.length - 1]);
    } else {
      volumeSeries.setData(volumeData);
    }

    previousCandlesRef.current = candles.map((candle) => ({ ...candle }));

    if (firstDataLoadRef.current && candles.length > 0) {
      chart.timeScale().fitContent();
      firstDataLoadRef.current = false;
    }
  }, [candles, chartMode]);

  const metrics = useMemo(() => {
    const first = candles[0];
    const latest = candles.at(-1);

    const latestPrice = latest?.close ?? 0;
    const startPrice = first?.open ?? latestPrice;

    const changePercent =
      startPrice > 0
        ? ((latestPrice - startPrice) / startPrice) * 100
        : 0;

    return {
      latestPrice,
      changePercent,
      high: candles.reduce(
        (highest, candle) => Math.max(highest, candle.high),
        0,
      ),
      low:
        candles.length > 0
          ? candles.reduce(
              (lowest, candle) => Math.min(lowest, candle.low),
              candles[0].low,
            )
          : 0,
    };
  }, [candles]);

  const resetChart = () => {
    chartRef.current?.timeScale().fitContent();
  };

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
            TradingView Lightweight Charts
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-3">
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

          <button
            type="button"
            onClick={resetChart}
            className="rounded-xl border border-white/10 px-3 py-2 text-xs font-black text-zinc-300"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Price"
          value={`${formatSol(metrics.latestPrice)} SOL`}
        />
        <Stat label="High" value={`${formatSol(metrics.high)} SOL`} />
        <Stat label="Low" value={`${formatSol(metrics.low)} SOL`} />
        <Stat label="Trades" value={String(trades.length)} />
      </div>

      <div className="mt-4 flex max-w-full gap-2 overflow-x-auto pb-1">
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

      <div className="relative mt-4 overflow-hidden rounded-2xl border border-white/10 bg-[#070707]">
        <div ref={containerRef} className="min-h-[460px] w-full" />

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
                The first completed Kodiak trade will create the first price candle.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
        <p>{message}</p>
        <p>
          {trades.length} recorded trade{trades.length === 1 ? "" : "s"}
        </p>
      </div>

      {trades.length > 0 && (
        <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
          <div className="border-b border-white/10 px-4 py-3 text-sm font-black">
            Recent trades
          </div>

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

                <span className="truncate text-zinc-400">
                  {shortWallet(trade.wallet)}
                </span>

                <span className="font-bold text-zinc-200">
                  {formatSol(trade.solAmount)} SOL
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-black/25 p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-600">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-black text-zinc-200">
        {value}
      </p>
    </div>
  );
}
