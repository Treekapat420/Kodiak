"use client";

import { useEffect, useRef, useState } from "react";
import {
  ColorType,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";

type Interval = "1m" | "5m" | "15m";
type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export function LaunchChart({ mint }: { mint: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [interval, setInterval] = useState<Interval>("1m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [message, setMessage] = useState("Loading chart…");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(
          `/api/token/${encodeURIComponent(mint)}/chart?interval=${interval}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as {
          candles?: Candle[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load chart.");
        }

        if (!cancelled) {
          const data = payload.candles ?? [];
          setCandles(data);
          setMessage(
            data.length
              ? `${data.length} candles loaded.`
              : "No trades yet. The first bonding-curve trade will begin the chart.",
          );
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error ? error.message : "Unable to load chart.",
          );
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
      height: 390,
      layout: {
        background: { type: ColorType.Solid, color: "#070707" },
        textColor: "#a1a1aa",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.05)" },
        horzLines: { color: "rgba(255,255,255,0.05)" },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "rgba(255,255,255,0.10)",
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.10)",
      },
    });

    const series = chart.addCandlestickSeries({
      upColor: "#6ee7b7",
      downColor: "#fb7185",
      borderUpColor: "#6ee7b7",
      borderDownColor: "#fb7185",
      wickUpColor: "#6ee7b7",
      wickDownColor: "#fb7185",
      priceFormat: {
        type: "price",
        precision: 10,
        minMove: 0.0000000001,
      },
    });

    series.setData(
      candles.map((candle) => ({
        ...candle,
        time: candle.time as UTCTimestamp,
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
  }, [candles]);

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black">Price chart</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Raydium LaunchLab Devnet OHLC · updates every 15 seconds
          </p>
        </div>
        <div className="flex gap-2">
          {(["1m", "5m", "15m"] as Interval[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setInterval(value)}
              className={`rounded-xl px-4 py-2 text-sm font-black ${
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

      <div
        ref={containerRef}
        className="mt-5 min-h-[390px] w-full overflow-hidden rounded-2xl border border-white/10"
      />
      <p className="mt-3 text-xs text-zinc-500">{message}</p>
    </section>
  );
}
