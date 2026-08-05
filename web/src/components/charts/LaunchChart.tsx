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

type ChartPayload = { candles?: Candle[]; error?: string };
type TradesPayload = { trades?: Trade[]; error?: string };

const INTERVALS: Interval[] = ["1s", "1m", "5m", "15m", "1h"];

function shortWallet(wallet: string) {
  return wallet ? `${wallet.slice(0, 4)}...${wallet.slice(-4)}` : "-";
}

function formatSol(value: number, digits = 8) {
  if (!Number.isFinite(value)) return "0";
  if (value === 0) return "0";
  if (Math.abs(value) >= 1) return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (Math.abs(value) >= 0.001) return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
  return value.toLocaleString("en-US", { maximumSignificantDigits: digits });
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "0.00%";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function normalizeCandles(candles: Candle[]) {
  return candles.map((candle) => ({
    ...candle,
    time: candle.time as UTCTimestamp,
  }));
}

export function LaunchChart({ mint }: { mint: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const fittedRef = useRef(false);

  const [interval, setInterval] = useState<Interval>("1m");
  const [chartMode, setChartMode] = useState<ChartMode>("candles");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [message, setMessage] = useState("Loading Kodiak market data...");
  const [loading, setLoading] = useState(true);

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

        if (!nextCandles.length) {
          setMessage("No trades yet. The first Kodiak trade will begin the chart.");
        } else if (nextCandles.length < 4) {
          setMessage(
            `${nextCandles.length} price point${nextCandles.length === 1 ? "" : "s"} loaded | sparse trading`,
          );
        } else {
          setMessage(
            `${nextCandles.length} candles loaded | updates every 3 seconds`,
          );
        }
      } catch (error) {
        if (!cancelled) {
          setLoading(false);
          setMessage(
            error instanceof Error ? error.message : "Unable to load chart.",
          );
        }
      }
    };

    fittedRef.current = false;
    void load();

    const timer = window.setInterval(() => {
      void load();
    }, 3_000);

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
        background: { type: ColorType.Solid, color: "#070707" },
        textColor: "#a1a1aa",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      crosshair: {
        vertLine: {
          color: "rgba(110,231,183,0.32)",
          labelBackgroundColor: "#111827",
        },
        horzLine: {
          color: "rgba(110,231,183,0.32)",
          labelBackgroundColor: "#111827",
        },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: interval === "1s",
        borderColor: "rgba(255,255,255,0.10)",
        rightOffset: 5,
        barSpacing: interval === "1s" ? 8 : 12,
        minBarSpacing: 3,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.10)",
        scaleMargins: { top: 0.08, bottom: 0.25 },
        autoScale: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      handleScroll: {
        horzTouchDrag: true,
        vertTouchDrag: false,
        mouseWheel: true,
        pressedMouseMove: true,
      },
    });

    const volume = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
      lastValueVisible: false,
      priceLineVisible: false,
    });

    volume.priceScale().applyOptions({
      scaleMargins: { top: 0.80, bottom: 0 },
    });

    chartRef.current = chart;
    volumeSeriesRef.current = volume;

    const observer = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.applyOptions({
      timeScale: {
        timeVisible: true,
        secondsVisible: interval === "1s",
        rightOffset: 5,
        barSpacing: interval === "1s" ? 8 : 12,
        minBarSpacing: 3,
      },
    });
  }, [interval]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (candleSeriesRef.current) {
      chart.removeSeries(candleSeriesRef.current);
      candleSeriesRef.current = null;
    }

    if (lineSeriesRef.current) {
      chart.removeSeries(lineSeriesRef.current);
      lineSeriesRef.current = null;
    }

    if (chartMode === "line") {
      lineSeriesRef.current = chart.addLineSeries({
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
    } else {
      candleSeriesRef.current = chart.addCandlestickSeries({
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
    }
  }, [chartMode]);

  useEffect(() => {
    const normalized = normalizeCandles(candles);

    if (chartMode === "line") {
      lineSeriesRef.current?.setData(
        normalized.map((candle) => ({
          time: candle.time,
          value: candle.close,
        })),
      );
    } else {
      candleSeriesRef.current?.setData(normalized);
    }

    volumeSeriesRef.current?.setData(
      normalized.map((candle) => ({
        time: candle.time,
        value: candle.volume ?? 0,
        color:
          candle.close >= candle.open
            ? "rgba(57,229,140,0.35)"
            : "rgba(255,77,103,0.35)",
      })),
    );

    if (candles.length > 0 && !fittedRef.current) {
      chartRef.current?.timeScale().fitContent();
      fittedRef.current = true;
    }
  }, [candles, chartMode]);

  const metrics = useMemo(() => {
    const first = candles[0];
    const latest = candles.at(-1);
    const latestPrice = latest?.close ?? 0;
    const startPrice = first?.open ?? latestPrice;
    const changePercent =
      startPrice > 0 ? ((latestPrice - startPrice) / startPrice) * 100 : 0;
    const volume = candles.reduce(
      (sum, candle) => sum + Number(candle.volume ?? 0),
      0,
    );

    return {
      latestPrice,
      changePercent,
      volume,
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

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
            Live market
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
          <p className="mt-1 text-xs text-zinc-500">
            Kodiak Devnet market data | real trades only
          </p>
        </div>

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
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Price" value={`${formatSol(metrics.latestPrice)} SOL`} />
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
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[1px]">
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
                The first completed Kodiak trade will create the first price
                candle.
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-black/25 p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-600">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-black text-zinc-200">{value}</p>
    </div>
  );
}
