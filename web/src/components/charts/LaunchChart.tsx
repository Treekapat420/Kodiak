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

import {
  kodiakExplorerTransactionUrl,
} from "@/lib/solana/network";

type Interval = "1s" | "1m" | "5m" | "15m" | "1h";
type Mode = "candles" | "line";
type Denomination = "SOL" | "USD";

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

type ChartResponse = {
  candles?: Candle[];
  error?: string;
};

type TradesResponse = {
  trades?: Trade[];
  error?: string;
};

type SolUsdPoint = {
  time: number;
  price: number;
};

type Ohlc = {
  open: number;
  high: number;
  low: number;
  close: number;
};

const INTERVALS: Interval[] = ["1s", "1m", "5m", "15m", "1h"];

function asTime(value: number) {
  return value as UTCTimestamp;
}

function shortWallet(value: string) {
  return value ? `${value.slice(0, 4)}...${value.slice(-4)}` : "-";
}

function formatPrice(value: number) {
  if (!Number.isFinite(value) || value === 0) return "0";

  const absolute = Math.abs(value);

  if (absolute >= 1) return value.toFixed(4);
  if (absolute >= 0.01) return value.toFixed(6);
  if (absolute >= 0.0001) return value.toFixed(8);
  if (absolute >= 0.000001) return value.toFixed(10);

  return value.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
}

function priceFormatFor(value: number) {
  const absolute = Math.abs(value);

  if (!Number.isFinite(absolute) || absolute === 0) {
    return {
      type: "price" as const,
      precision: 10,
      minMove: 0.0000000001,
    };
  }

  if (absolute >= 1) {
    return {
      type: "price" as const,
      precision: 4,
      minMove: 0.0001,
    };
  }

  if (absolute >= 0.01) {
    return {
      type: "price" as const,
      precision: 6,
      minMove: 0.000001,
    };
  }

  if (absolute >= 0.0001) {
    return {
      type: "price" as const,
      precision: 8,
      minMove: 0.00000001,
    };
  }

  if (absolute >= 0.000001) {
    return {
      type: "price" as const,
      precision: 10,
      minMove: 0.0000000001,
    };
  }

  return {
    type: "price" as const,
    precision: 12,
    minMove: 0.000000000001,
  };
}

function chartHeight(expanded: boolean) {
  if (expanded) {
    return Math.max(window.innerHeight - 170, 420);
  }

  return Math.min(
    560,
    Math.max(
      420,
      Math.round(window.innerHeight * 0.52),
    ),
  );
}

function chartWindow(candleCount: number, expanded: boolean) {
  if (candleCount <= 1) {
    return {
      from: -10,
      to: expanded ? 16 : 12,
      barSpacing: expanded ? 20 : 17,
      rightOffset: expanded ? 8 : 6,
    };
  }

  if (candleCount <= 4) {
    return {
      from: -4,
      to: expanded ? 11 : 9,
      barSpacing: expanded ? 22 : 19,
      rightOffset: expanded ? 6 : 5,
    };
  }

  if (candleCount <= 12) {
    return {
      from: -1,
      to: candleCount + (expanded ? 5 : 4),
      barSpacing: expanded ? 18 : 15,
      rightOffset: expanded ? 5 : 4,
    };
  }

  if (candleCount <= 30) {
    return {
      from: Math.max(0, candleCount - 24),
      to: candleCount + (expanded ? 4 : 3),
      barSpacing: expanded ? 14 : 11,
      rightOffset: expanded ? 4 : 3,
    };
  }

  return null;
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
  const fittedRef = useRef(false);

  const [interval, setInterval] = useState<Interval>("1m");
  const [mode, setMode] = useState<Mode>("candles");
  const [denomination, setDenomination] = useState<Denomination>("SOL");
  const [solUsd, setSolUsd] = useState<SolUsdPoint[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [hovered, setHovered] = useState<Ohlc | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState("Loading chart...");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [chartResult, tradesResult] = await Promise.all([
          fetch(
            `/api/token/${encodeURIComponent(mint)}/chart?interval=${interval}`,
            { cache: "no-store" },
          ),
          fetch(`/api/token/${encodeURIComponent(mint)}/trades`, {
            cache: "no-store",
          }),
        ]);

        const chartPayload = (await chartResult.json()) as ChartResponse;
        const tradesPayload = (await tradesResult.json()) as TradesResponse;

        if (!chartResult.ok) {
          throw new Error(chartPayload.error || "Unable to load chart.");
        }

        if (!tradesResult.ok) {
          throw new Error(tradesPayload.error || "Unable to load trades.");
        }

        if (cancelled) return;

        const nextCandles = chartPayload.candles ?? [];
        const nextTrades = tradesPayload.trades ?? [];

        setCandles(nextCandles);
        setTrades(nextTrades);
        setLoading(false);
        setMessage(
          nextCandles.length
            ? `${nextCandles.length} candle${nextCandles.length === 1 ? "" : "s"} ÃÂ· live updates every 3 seconds`
            : "No trades yet.",
        );
      } catch (error) {
        if (!cancelled) {
          setLoading(false);
          setMessage(
            error instanceof Error ? error.message : "Unable to load chart.",
          );
        }
      }
    }

    setLoading(true);
    fittedRef.current = false;
    previousCandlesRef.current = [];
    setHovered(null);

    void load();
    const timer = window.setInterval(() => void load(), 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [interval, mint]);

  useEffect(() => {
    if (denomination !== "USD" || candles.length === 0) return;

    let cancelled = false;

    async function loadSolUsd() {
      const first = candles[0]?.time ?? Math.floor(Date.now() / 1000);
      const last = candles.at(-1)?.time ?? first;
      const from = Math.max(0, first - 3600);
      const to = Math.max(last + 3600, Math.floor(Date.now() / 1000));

      try {
        const response = await fetch(`/api/market/sol-usd?from=${from}&to=${to}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as { prices?: SolUsdPoint[] };
        if (!response.ok || !payload.prices?.length) {
          throw new Error("Unable to load SOL/USD history.");
        }
        if (!cancelled) setSolUsd(payload.prices);
      } catch {
        if (!cancelled) setSolUsd([]);
      }
    }

    void loadSolUsd();
    return () => { cancelled = true; };
  }, [denomination, candles.length, candles[0]?.time, candles.at(-1)?.time]);

  const displayedCandles = useMemo(() => {
    if (denomination === "SOL" || solUsd.length === 0) return candles;

    function usdAt(time: number) {
      let best = solUsd[0];
      let bestDistance = Math.abs(best.time - time);
      for (let i = 1; i < solUsd.length; i += 1) {
        const distance = Math.abs(solUsd[i].time - time);
        if (distance < bestDistance) {
          best = solUsd[i];
          bestDistance = distance;
        }
      }
      return best.price;
    }

    return candles.map((candle) => {
      const usd = usdAt(candle.time);
      return {
        ...candle,
        open: candle.open * usd,
        high: candle.high * usd,
        low: candle.low * usd,
        close: candle.close * usd,
      };
    });
  }, [candles, denomination, solUsd]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: chartHeight(expanded),
      layout: {
        background: {
          type: ColorType.Solid,
          color: "#070707",
        },
        textColor: "#a1a1aa",
      },
      localization: {
        priceFormatter: formatPrice,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(110,231,183,0.4)",
          labelBackgroundColor: "#163329",
        },
        horzLine: {
          color: "rgba(110,231,183,0.4)",
          labelBackgroundColor: "#163329",
        },
      },
      rightPriceScale: {
        visible: true,
        autoScale: true,
        borderColor: "rgba(255,255,255,0.12)",
        scaleMargins: {
          top: 0.10,
          bottom: 0.24,
        },
      },
      timeScale: {
        visible: true,
        timeVisible: true,
        secondsVisible: interval === "1s",
        borderColor: "rgba(255,255,255,0.12)",
        rightOffset: 4,
        barSpacing: 11,
        minBarSpacing: 3,
        lockVisibleTimeRangeOnResize: true,
        rightBarStaysOnScroll: false,
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

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#39e58c",
      downColor: "#ff4d67",
      borderVisible: false,
      wickUpColor: "#39e58c",
      wickDownColor: "#ff4d67",
      priceLineVisible: true,
      lastValueVisible: true,
      priceFormat: priceFormatFor(0),
      visible: mode === "candles",
    });

    const lineSeries = chart.addLineSeries({
      color: "#6ee7b7",
      lineWidth: 2,
      crosshairMarkerVisible: true,
      priceLineVisible: true,
      lastValueVisible: true,
      priceFormat: priceFormatFor(0),
      visible: mode === "line",
    });

    const volumeSeries = chart.addHistogramSeries({
      priceScaleId: "",
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: false,
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.76,
        bottom: 0,
      },
    });

    const onCrosshairMove = (param: MouseEventParams<Time>) => {
      const data = param.seriesData.get(candleSeries);

      if (
        data &&
        "open" in data &&
        "high" in data &&
        "low" in data &&
        "close" in data
      ) {
        setHovered({
          open: Number(data.open),
          high: Number(data.high),
          low: Number(data.low),
          close: Number(data.close),
        });
      } else {
        setHovered(null);
      }
    };

    chart.subscribeCrosshairMove(onCrosshairMove);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    lineSeriesRef.current = lineSeries;
    volumeSeriesRef.current = volumeSeries;
    fittedRef.current = false;
    previousCandlesRef.current = [];

    const resize = () => {
      const target = containerRef.current;
      if (!target) return;

      chart.applyOptions({
        width: target.clientWidth,
        height: chartHeight(expanded),
      });
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    window.addEventListener("resize", resize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.remove();

      chartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [expanded, interval]);

  useEffect(() => {
    candleSeriesRef.current?.applyOptions({
      visible: mode === "candles",
    });

    lineSeriesRef.current?.applyOptions({
      visible: mode === "line",
    });
  }, [mode]);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const lineSeries = lineSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;

    if (!chart || !candleSeries || !lineSeries || !volumeSeries) return;

    const candleData: BarData[] = displayedCandles.map((item) => ({
      time: asTime(item.time),
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
    }));

    const lineData: LineData[] = displayedCandles.map((item) => ({
      time: asTime(item.time),
      value: item.close,
    }));

    const volumeData: HistogramData[] = displayedCandles.map((item) => ({
      time: asTime(item.time),
      value: Number(item.volume ?? 0),
      color:
        item.close >= item.open
          ? "rgba(57,229,140,0.35)"
          : "rgba(255,77,103,0.35)",
    }));

    const previous = previousCandlesRef.current;
    const latestOnly =
      previous.length > 0 &&
      displayedCandles.length >= previous.length &&
      displayedCandles.length <= previous.length + 1 &&
      previous
        .slice(0, -1)
        .every((item, index) => sameCandle(item, displayedCandles[index]));

    if (latestOnly && displayedCandles.length > 0) {
      candleSeries.update(candleData[candleData.length - 1]);
      lineSeries.update(lineData[lineData.length - 1]);
      volumeSeries.update(volumeData[volumeData.length - 1]);
    } else {
      candleSeries.setData(candleData);
      lineSeries.setData(lineData);
      volumeSeries.setData(volumeData);
    }

    previousCandlesRef.current = displayedCandles.map((item) => ({ ...item }));

    if (displayedCandles.length > 0) {
      const currentPrice =
        displayedCandles.at(-1)?.close ??
        0;

      const seriesPriceFormat =
        priceFormatFor(
          currentPrice,
        );

      candleSeries.applyOptions({
        priceFormat:
          seriesPriceFormat,
      });

      lineSeries.applyOptions({
        priceFormat:
          seriesPriceFormat,
      });

      if (!fittedRef.current) {
        const window =
          chartWindow(
            displayedCandles.length,
            expanded,
          );

        if (window) {
          chart.timeScale().applyOptions({
            barSpacing:
              window.barSpacing,
            rightOffset:
              window.rightOffset,
          });

          chart.timeScale().setVisibleLogicalRange({
            from:
              window.from,
            to:
              window.to,
          });
        } else {
          chart.timeScale().applyOptions({
            barSpacing:
              expanded
                ? 10
                : 8,
            rightOffset:
              expanded
                ? 4
                : 3,
          });

          chart.timeScale().fitContent();
        }

        fittedRef.current =
          true;
      }
    }
  }, [displayedCandles, expanded]);

  useEffect(() => {
    if (!expanded) return;

    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = oldOverflow;
    };
  }, [expanded]);

  const latest = displayedCandles.at(-1);

  const metrics = useMemo(() => {
    const first = displayedCandles[0];
    const last = displayedCandles.at(-1);
    const price = last?.close ?? 0;
    const start = first?.open ?? price;

    return {
      price,
      change:
        start > 0
          ? ((price - start) / start) * 100
          : 0,
    };
  }, [displayedCandles]);

  const display = hovered ?? {
    open: latest?.open ?? 0,
    high: latest?.high ?? 0,
    low: latest?.low ?? 0,
    close: latest?.close ?? 0,
  };

  const reset = () => {
    const chart = chartRef.current;
    if (!chart || candles.length === 0) return;

    const window =
      chartWindow(
        candles.length,
        expanded,
      );

    if (window) {
      chart.timeScale().applyOptions({
        barSpacing:
          window.barSpacing,
        rightOffset:
          window.rightOffset,
      });

      chart.timeScale().setVisibleLogicalRange({
        from:
          window.from,
        to:
          window.to,
      });
    } else {
      chart.timeScale().applyOptions({
        barSpacing:
          expanded
            ? 10
            : 8,
        rightOffset:
          expanded
            ? 4
            : 3,
      });

      chart.timeScale().fitContent();
    }

    chart.priceScale("right").applyOptions({
      autoScale: true,
      scaleMargins: {
        top: 0.10,
        bottom: 0.24,
      },
    });
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
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
            Live market
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-black">Price chart</h2>

            {metrics.price > 0 && (
              <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-300">
                {denomination === "USD" ? "$" : ""}{formatPrice(metrics.price)} {denomination}
              </span>
            )}

            {candles.length > 1 && (
              <span
                className={`rounded-full px-3 py-1 text-xs font-black ${
                  metrics.change >= 0
                    ? "bg-emerald-400/10 text-emerald-300"
                    : "bg-rose-400/10 text-rose-300"
                }`}
              >
                {metrics.change > 0 ? "+" : ""}
                {metrics.change.toFixed(2)}%
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="flex rounded-xl border border-white/10 p-1">
            {(["SOL", "USD"] as Denomination[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setDenomination(value)}
                className={`rounded-lg px-3 py-2 text-xs font-black ${
                  denomination === value ? "bg-emerald-400 text-black" : "text-zinc-400"
                }`}
              >
                {value}
              </button>
            ))}
          </div>

          <div className="flex rounded-xl border border-white/10 p-1">
            <button
              type="button"
              onClick={() => setMode("candles")}
              className={`rounded-lg px-3 py-2 text-xs font-black ${
                mode === "candles"
                  ? "bg-white text-black"
                  : "text-zinc-400"
              }`}
            >
              Candles
            </button>

            <button
              type="button"
              onClick={() => setMode("line")}
              className={`rounded-lg px-3 py-2 text-xs font-black ${
                mode === "line"
                  ? "bg-white text-black"
                  : "text-zinc-400"
              }`}
            >
              Line
            </button>
          </div>

          <button
            type="button"
            onClick={reset}
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
        <span>O {denomination === "USD" ? "$" : ""}{formatPrice(display.open)}</span>
        <span>H {denomination === "USD" ? "$" : ""}{formatPrice(display.high)}</span>
        <span>L {denomination === "USD" ? "$" : ""}{formatPrice(display.low)}</span>
        <span>C {denomination === "USD" ? "$" : ""}{formatPrice(display.close)}</span>
      </div>

      <div
        className={`relative mt-3 overflow-hidden rounded-2xl border border-white/10 bg-[#070707] ${
          expanded ? "min-h-0 flex-1" : ""
        }`}
      >
        <div
          ref={containerRef}
          onDoubleClick={reset}
          className={expanded ? "h-full w-full" : "w-full"}
          style={{
            height:
              expanded
                ? "100%"
                : "clamp(420px, 52vh, 560px)",
            touchAction: "none",
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
                The first completed trade will create the first candle.
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
              <div className="border-b border-white/10 px-4 py-3 text-sm font-black">
                Recent trades
              </div>

              <div className="divide-y divide-white/5">
                {trades.slice(0, 8).map((trade) => (
                  <a
                    key={trade.signature}
                    href={kodiakExplorerTransactionUrl(
                      trade.signature,
                    )}
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
                      {formatPrice(trade.solAmount)} SOL
                    </span>
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
