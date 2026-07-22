"use client";

import { useEffect, useRef, useState } from "react";
import {
  ColorType,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";

type Interval = "1s" | "1m" | "5m" | "15m" | "1h";

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
  return `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
}

function formatSol(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1) return value.toFixed(4);
  if (value >= 0.001) return value.toFixed(6);
  return value.toPrecision(4);
}

export function LaunchChart({ mint }: { mint: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [interval, setInterval] = useState<Interval>("1m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [message, setMessage] = useState("Loading Kodiak market data…");

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

        if (!cancelled) {
          const nextCandles = chartPayload.candles ?? [];
          const nextTrades = tradesPayload.trades ?? [];
          setCandles(nextCandles);
          setTrades(nextTrades);

          if (!nextCandles.length) {
            setMessage("No trades yet. The first Kodiak trade will begin the chart.");
          } else if (nextCandles.length < 4) {
            setMessage(`${nextCandles.length} price point${nextCandles.length === 1 ? "" : "s"} loaded · sparse-trading mode`);
          } else {
            setMessage(`${nextCandles.length} candles loaded · updates every 15 seconds`);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "Unable to load chart.");
        }
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [interval, mint]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    chartRef.current?.remove();

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 430,
      layout: {
        background: { type: ColorType.Solid, color: "#070707" },
        textColor: "#a1a1aa",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.045)" },
        horzLines: { color: "rgba(255,255,255,0.045)" },
      },
      crosshair: {
        vertLine: { color: "rgba(110,231,183,0.35)" },
        horzLine: { color: "rgba(110,231,183,0.35)" },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: interval === "1s",
        borderColor: "rgba(255,255,255,0.10)",
        rightOffset: 4,
        barSpacing: interval === "1s" ? 10 : 16,
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.10)",
        scaleMargins: { top: 0.08, bottom: 0.28 },
      },
    });

    const normalized = candles.map((candle) => ({
      ...candle,
      time: candle.time as UTCTimestamp,
    }));

    if (candles.length > 0 && candles.length < 4) {
      const line = chart.addLineSeries({
        color: "#6ee7b7",
        lineWidth: 3,
        crosshairMarkerVisible: true,
        priceLineVisible: true,
        lastValueVisible: true,
        priceFormat: { type: "price", precision: 10, minMove: 0.0000000001 },
      });

      line.setData(normalized.map((candle) => ({ time: candle.time, value: candle.close })));
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
        priceFormat: { type: "price", precision: 10, minMove: 0.0000000001 },
      });

      series.setData(normalized);
    }

    const volume = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
      lastValueVisible: false,
      priceLineVisible: false,
    });

    volume.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    volume.setData(
      normalized.map((candle) => ({
        time: candle.time,
        value: candle.volume ?? 0,
        color: candle.close >= candle.open ? "rgba(57,229,140,0.42)" : "rgba(255,77,103,0.42)",
      })),
    );

    if (candles.length) chart.timeScale().fitContent();

    const observer = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });

    observer.observe(container);
    chartRef.current = chart;

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, interval]);

  const latest = candles.at(-1)?.close;

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-black">Price chart</h2>
            {latest ? (
              <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-300">
                {formatSol(latest)} SOL
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-zinc-500">Kodiak Devnet market data · real trades only</p>
        </div>

        <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
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
      </div>

      <div ref={containerRef} className="mt-5 min-h-[430px] w-full overflow-hidden rounded-2xl border border-white/10" />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
        <p>{message}</p>
        <p>{trades.length} recorded trade{trades.length === 1 ? "" : "s"}</p>
      </div>

      {trades.length ? (
        <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
          <div className="border-b border-white/10 px-4 py-3 text-sm font-black">Recent trades</div>
          <div className="divide-y divide-white/5">
            {trades.slice(0, 6).map((trade) => (
              <a
                key={trade.signature}
                href={`https://explorer.solana.com/tx/${trade.signature}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
                className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 text-xs transition hover:bg-white/[0.03]"
              >
                <span className={`rounded-full px-2 py-1 font-black ${
                  trade.side === "buy"
                    ? "bg-emerald-400/10 text-emerald-300"
                    : "bg-rose-400/10 text-rose-300"
                }`}>
                  {trade.side.toUpperCase()}
                </span>
                <span className="truncate text-zinc-400">{shortWallet(trade.wallet)}</span>
                <span className="font-bold text-zinc-200">{formatSol(trade.solAmount)} SOL</span>
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
