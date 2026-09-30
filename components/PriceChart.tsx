"use client";
import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  createSeriesMarkers,
  ColorType,
  LineStyle,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type UTCTimestamp,
  type IPriceLine,
  type Time,
  type SeriesMarker,
} from "lightweight-charts";
import type { Candle, Quote, Trade, Position } from "../src/types";
interface Props {
  candles: Candle[];
  forming: Candle | null;
  quote: Quote | null;
  trades: Trade[];
  position: Position | null;
  bars: number;
}
const utc = (closeTime: number) =>
  Math.floor((closeTime - 300000) / 1000) as UTCTimestamp;
function ema(candles: Candle[], period: number) {
  let value = 0;
  return candles.map((c, i) => {
    value = i
      ? (c.close * 2) / (period + 1) + value * (1 - 2 / (period + 1))
      : c.close;
    return { time: utc(c.time), value };
  });
}
export default function PriceChart({
  candles,
  forming,
  quote,
  trades,
  position,
  bars,
}: Props) {
  const host = useRef<HTMLDivElement>(null),
    chart = useRef<IChartApi | null>(null),
    price = useRef<ISeriesApi<"Candlestick"> | null>(null),
    fast = useRef<ISeriesApi<"Line"> | null>(null),
    slow = useRef<ISeriesApi<"Line"> | null>(null),
    volume = useRef<ISeriesApi<"Histogram"> | null>(null),
    markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null),
    lines = useRef<IPriceLine[]>([]),
    initialized = useRef(false);
  const [readout, setReadout] = useState(
    "Hover to inspect candles · drag to pan · scroll to zoom",
  );
  useEffect(() => {
    if (!host.current) return;
    const c = createChart(host.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#111920" },
        textColor: "#91a2b0",
        fontSize: 12,
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "#192832" },
        horzLines: { color: "#22313b" },
      },
      rightPriceScale: {
        borderColor: "#2a3945",
        scaleMargins: { top: 0.12, bottom: 0.24 },
      },
      timeScale: {
        borderColor: "#2a3945",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
      },
      crosshair: { mode: CrosshairMode.Normal },
    });
    chart.current = c;
    const p = c.addSeries(CandlestickSeries, {
      upColor: "#60e2b4",
      downColor: "#ee8797",
      wickUpColor: "#60e2b4",
      wickDownColor: "#ee8797",
      borderVisible: false,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    price.current = p;
    fast.current = c.addSeries(LineSeries, {
      color: "#edc775",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    slow.current = c.addSeries(LineSeries, {
      color: "#81aaf5",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    volume.current = c.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volume.current
      .priceScale()
      .applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    markers.current = createSeriesMarkers(p, []);
    c.subscribeCrosshairMove((event) => {
      const bar = event.seriesData.get(p);
      if (!event.time || !bar || !("open" in bar)) {
        setReadout("Hover to inspect candles · drag to pan · scroll to zoom");
        return;
      }
      const date =
        typeof event.time === "number"
          ? new Date(event.time * 1000)
              .toISOString()
              .slice(0, 16)
              .replace("T", " ")
          : String(event.time);
      setReadout(
        `${date} UTC · O ${bar.open.toFixed(2)}  H ${bar.high.toFixed(2)}  L ${bar.low.toFixed(2)}  C ${bar.close.toFixed(2)}`,
      );
    });
    return () => {
      c.remove();
      chart.current = null;
      price.current = null;
      fast.current = null;
      slow.current = null;
      volume.current = null;
      markers.current = null;
      lines.current = [];
      initialized.current = false;
    };
  }, []);
  useEffect(() => {
    if (!chart.current || !price.current || !candles.length) return;
    const all =
      forming && forming.time > candles.at(-1)!.time
        ? [...candles, forming]
        : candles;
    price.current.setData(
      all.map((c) => ({
        time: utc(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    fast.current?.setData(ema(all, 20));
    slow.current?.setData(ema(all, 50));
    volume.current?.setData(
      all.map((c) => ({
        time: utc(c.time),
        value: c.volume,
        color: c.close >= c.open ? "#265a4b" : "#5a3742",
      })),
    );
    const first = utc(all[0].time),
      last = utc(all.at(-1)!.time);
    const ms: SeriesMarker<Time>[] = trades
      .map((t) => ({
        time: (Math.floor(t.time / 300000) * 300) as UTCTimestamp,
        position:
          t.side === "entry" ? ("belowBar" as const) : ("aboveBar" as const),
        color: t.side === "entry" ? "#60e2b4" : "#ffb086",
        shape:
          t.side === "entry" ? ("arrowUp" as const) : ("arrowDown" as const),
        text: `${t.side === "entry" ? "BUY" : "SELL"} $${t.price.toFixed(2)}`,
      }))
      .filter((m) => m.time >= first && m.time <= last)
      .sort((a, b) => Number(a.time) - Number(b.time));
    markers.current?.setMarkers(ms);
    if (!initialized.current) {
      chart.current
        .timeScale()
        .setVisibleLogicalRange({
          from: Math.max(0, all.length - bars),
          to: all.length + 5,
        });
      initialized.current = true;
    }
  }, [candles, forming, trades, bars]);
  useEffect(() => {
    if (chart.current && candles.length)
      chart.current
        .timeScale()
        .setVisibleLogicalRange({
          from: Math.max(0, candles.length - bars),
          to: candles.length + 6,
        });
  }, [bars]);
  useEffect(() => {
    const p = price.current;
    if (!p) return;
    for (const line of lines.current) p.removePriceLine(line);
    lines.current = [];
    const entries = position
      ? [
          { price: position.entry, title: "ENTRY", color: "#60e2b4" },
          { price: position.stop, title: "STOP", color: "#ee8797" },
          { price: position.target, title: "TARGET", color: "#edc775" },
        ]
      : [];
    if (quote)
      entries.push({
        price: quote.last ?? quote.bid,
        title: "LIVE",
        color: "#97aab8",
      });
    for (const e of entries)
      lines.current.push(
        p.createPriceLine({
          ...e,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
        }),
      );
  }, [position, quote]);
  return (
    <>
      <div
        className="chart-surface"
        role="img"
        aria-label="Interactive Bitcoin candlestick chart with volume, EMA 20, EMA 50 and virtual buy/sell markers"
      >
        <div ref={host} />
        {!candles.length && (
          <div id="emptyChart">Waiting for price history…</div>
        )}
      </div>
      <div className="chart-foot">
        <span>{readout}</span>
        <span>
          UTC ·{" "}
          <a
            href="https://www.tradingview.com/"
            target="_blank"
            rel="noreferrer"
          >
            TradingView
          </a>
        </span>
      </div>
    </>
  );
}
