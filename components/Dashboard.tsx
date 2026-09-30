"use client";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "./ui/select";
import { MARKETS, parseMarket, type MarketSymbol } from "../src/markets";
import type { Snapshot } from "../src/types";
const PriceChart = dynamic(() => import("./PriceChart"), {
  ssr: false,
  loading: () => <div className="loading">Loading chart…</div>,
});
const money = (n?: number | null) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(n);
const pct = (n?: number | null) =>
  n == null ? "—" : (n * 100).toFixed(1) + "%";
const time = (n?: number) =>
  n == null
    ? "—"
    : new Date(n).toISOString().replace("T", " ").slice(0, 19) + " UTC";
type Tab = "decisions" | "trades" | "events";
export default function Dashboard() {
  const [market, setMarket] = useState<MarketSymbol>("BTC");
  useEffect(() => {
    try {
      setMarket(parseMarket(localStorage.getItem("paper-market")) || "BTC");
    } catch {}
  }, []);
  function selectMarket(symbol: MarketSymbol) {
    setMarket(symbol);
    try {
      localStorage.setItem("paper-market", symbol);
    } catch {}
  }
  return (
    <MarketDashboard key={market} market={market} selectMarket={selectMarket} />
  );
}
function MarketDashboard({
  market,
  selectMarket,
}: {
  market: MarketSymbol;
  selectMarket: (market: MarketSymbol) => void;
}) {
  const asset = MARKETS[market];
  const [data, setData] = useState<Snapshot | null>(null),
    [failure, setFailure] = useState<string | null>(null),
    [tab, setTab] = useState<Tab>("decisions"),
    [bars, setBars] = useState(144),
    [pending, setPending] = useState(false),
    [clock, setClock] = useState("");
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/state?market=" + market, {
        cache: "no-store",
      });
      if (!r.ok) {
        const body = await r
          .json()
          .catch(() => ({ error: "Paper engine unavailable" }));
        throw new Error(body.error || "Paper engine unavailable");
      }
      const next: Snapshot = await r.json();
      if (next.market?.symbol !== market)
        throw new Error(
          "Market data mismatch. Refresh after deployment completes.",
        );
      setData(next);
      setFailure(null);
    } catch (e) {
      setFailure(
        e instanceof Error
          ? e.message
          : "Disconnected from the paper engine. Displayed values may be stale.",
      );
    }
  }, [market]);
  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), 3000),
      tick = setInterval(
        () => setClock(new Date().toISOString().slice(11, 19) + " UTC"),
        1000,
      );
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [refresh]);
  async function action(name: string) {
    setPending(true);
    try {
      const r = await fetch("/api/" + name + "?market=" + market, {
          method: "POST",
        }),
        body: { error?: string } = await r.json();
      if (!r.ok) throw new Error(body.error || "Action failed");
      await refresh();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Action failed");
    } finally {
      setPending(false);
    }
  }
  const s = data?.state,
    m = data?.metrics,
    a = data?.indicators,
    j = s?.decisions
      .slice()
      .reverse()
      .find((d) => d.forecast),
    latest = s?.decisions.at(-1),
    p = s?.position;
  const notice =
    failure ||
    data?.error ||
    latest?.error ||
    (data
      ? !data.keyConfigured
        ? "Add TYPESAFE_API_KEY to .env and restart the paper engine. Prices and indicators work without a key."
        : data.running
          ? data.busy
            ? "Jev is assessing the latest closed candle…"
            : "Paper trading active · one Jev evaluation per new 5-minute candle."
          : "Entries paused. Existing position risk exits remain active while the engine runs."
      : "Connecting to the paper engine…");
  let heads: string[], rows: React.ReactNode[][];
  if (tab === "trades") {
    heads = [
      "FILL TIME (UTC)",
      "SIDE",
      "FILL PRICE",
      market,
      "FEE",
      "REALIZED P&L",
      "REASON",
    ];
    rows = (s?.trades.slice().reverse() ?? []).map((t) => [
      time(t.time),
      <span className={t.side === "entry" ? "positive" : "yellow"}>
        {t.side.toUpperCase()}
      </span>,
      money(t.price),
      t.qty.toFixed(6),
      money(t.fee),
      <span className={(t.pnl ?? 0) >= 0 ? "positive" : "negative"}>
        {money(t.pnl)}
      </span>,
      t.reason,
    ]);
  } else if (tab === "events") {
    heads = ["TIME (UTC)", "TYPE", "EVENT"];
    rows = (data?.events ?? []).map((e) => [time(e.time), e.type, e.message]);
  } else {
    heads = [
      "CANDLE CLOSE (UTC)",
      "FORECAST / ACTION",
      "CONFIDENCE",
      "TECHNICAL PATTERNS",
      "30M OUTCOME",
      "RECEIVED (UTC)",
    ];
    rows = (s?.decisions.slice().reverse() ?? []).map((d) => [
      time(d.candleTime),
      d.error ? "ERROR" : `${d.forecast?.choice.toUpperCase()} / ${d.action}`,
      pct(d.forecast?.confidence),
      d.error || d.indicators.patterns.join(", ") || "No configured pattern",
      d.outcome
        ? `${d.outcome.returnPct.toFixed(3)}% · ${d.outcome.correct === null ? "abstained" : d.outcome.correct ? "correct" : "incorrect"}`
        : "Pending",
      time(d.receivedAt),
    ]);
  }
  const cards = [
    ["EMA 20", money(a?.ema20), "Fast trend"],
    ["EMA 50", money(a?.ema50), "Slow trend"],
    ["RSI 14", a?.rsi.toFixed(2) ?? "—", "Wilder smoothing"],
    ["ATR 14", money(a?.atr), "Price volatility"],
    [
      "VOLUME",
      a ? `${a.volumeRatio.toFixed(2)}×` : "—",
      "Against prior 20 bars",
    ],
    ["STRUCTURE", a?.trend.toUpperCase() ?? "—", "EMA 20 vs EMA 50"],
  ];
  return (
    <>
      <header>
        <div className="brand">
          <span className="logo">{market === "BTC" ? "₿" : "◎"}</span>
          <div>
            CRYPTO <strong>PAPER LAB</strong>
            <small>Research terminal / 01</small>
          </div>
        </div>
        <div className="header-right">
          <span className="badge">VIRTUAL FUNDS ONLY</span>
          <span id="clock">{clock}</span>
        </div>
      </header>
      <main>
        <section className="heading">
          <div>
            <p className="eyebrow">MARKET OBSERVATORY</p>
            <h1>Watch the signal. Measure the result.</h1>
            <p className="muted">
              {asset.name} technical analysis · Jev forecasts · Timestamped
              paper execution
            </p>
          </div>
          <div className="actions">
            <div className="market-select">
              <label htmlFor="market-picker">Market</label>
              <Select
                value={market}
                disabled={pending}
                onValueChange={(value) => selectMarket(value as MarketSymbol)}
              >
                <SelectTrigger id="market-picker" aria-label="Trading market">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(MARKETS).map((m) => (
                    <SelectItem key={m.symbol} value={m.symbol}>
                      {m.pair} · {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <a
              href={"/api/export?market=" + market}
              className="button secondary"
            >
              Export session
            </a>
            <button
              id="start"
              disabled={!data?.keyConfigured || pending || !!failure}
              onClick={() => void action(data?.running ? "pause" : "start")}
            >
              {pending
                ? "Updating…"
                : data?.running
                  ? "Pause entries"
                  : "Start paper trading"}
            </button>
          </div>
        </section>
        <div className="market-summary">
          <span>
            Separate $10,000 virtual portfolios. Start/pause applies to {market}{" "}
            only.
          </span>
          <span>Switching views does not pause trading.</span>
          {data?.markets?.map((m) => (
            <span key={m.symbol} className="tag">
              {m.symbol}: {m.running ? "ACTIVE" : "PAUSED"}
              {m.hasPosition ? " · POSITION OPEN" : ""}
            </span>
          ))}
        </div>
        <div
          className={`notice ${failure ? "dashboard-error" : ""}`}
          role="status"
        >
          {notice}
        </div>
        <section className="metrics">
          <article>
            <label>{asset.name.toUpperCase()} / USD</label>
            <strong id="price">{money(data?.quote?.last)}</strong>
            <small>
              Kraken ·{" "}
              {data?.updatedAt ? time(data.updatedAt).slice(11) : "Connecting"}
            </small>
          </article>
          <article>
            <label>PAPER EQUITY</label>
            <strong>{money(m?.equity)}</strong>
            <small className={(m?.netPnl ?? 0) >= 0 ? "positive" : "negative"}>
              Net P&L {money(m?.netPnl)} · includes open position
            </small>
          </article>
          <article>
            <label>CLOSED TRADES</label>
            <strong>{m?.closedTrades ?? 0}</strong>
            <small>Win rate {pct(m?.winRate)}</small>
          </article>
          <article>
            <label>FORECAST ACCURACY</label>
            <strong>{pct(m?.forecastAccuracy)}</strong>
            <small>
              {m?.resolvedForecasts ?? 0} resolved directional forecasts
            </small>
          </article>
        </section>
        <div className="workspace">
          <section className="panel chart-panel">
            <div className="panel-title">
              <div>
                <h2>
                  {market} / USD <span className="tag">5 MIN</span>
                </h2>
                <p>
                  Kraken candles · live candle shown, closed candles drive
                  decisions
                </p>
              </div>
              <label className="range-label">
                View{" "}
                <select
                  id="range"
                  value={bars}
                  onChange={(e) => setBars(Number(e.target.value))}
                >
                  <option value={60}>5 hours</option>
                  <option value={144}>12 hours</option>
                  <option value={288}>24 hours</option>
                  <option value={720}>All available</option>
                </select>
              </label>
            </div>
            <div className="legend">
              <span className="mint">━ Candles</span>
              <span className="yellow">━ EMA 20</span>
              <span className="blue">━ EMA 50</span>
              <span>▥ Volume</span>
              <span>▲ Buy</span>
              <span>▼ Sell</span>
            </div>
            <PriceChart
              candles={data?.candles ?? []}
              forming={data?.formingCandle ?? null}
              quote={data?.quote ?? null}
              trades={s?.trades ?? []}
              position={p ?? null}
              bars={bars}
            />
          </section>
          <aside className="panel">
            <div className="panel-title">
              <h2>Jev assessment</h2>
              <span className="tag">
                {data?.busy
                  ? "EVALUATING"
                  : j
                    ? "CONNECTED"
                    : data?.keyConfigured
                      ? "READY"
                      : "KEY NEEDED"}
              </span>
            </div>
            <div className="assessment">
              <label>30-MINUTE DIRECTION</label>
              <h3>{j?.forecast?.choice.toUpperCase() ?? "Waiting"}</h3>
              <p className="muted fine">
                {j
                  ? "Latest successful assessment · " + time(j.receivedAt)
                  : "Start a session to record the first forecast."}
              </p>
              {(["up", "down", "unclear"] as const).map((k) => (
                <div className="prob-row" key={k}>
                  <span>{k[0].toUpperCase() + k.slice(1)}</span>
                  <progress
                    max={1}
                    value={j?.forecast?.probabilities[k] ?? 0}
                  />
                  <b>{pct(j?.forecast?.probabilities[k])}</b>
                </div>
              ))}
              <dl>
                <dt>Answer confidence</dt>
                <dd>{pct(j?.forecast?.confidence)}</dd>
                <dt>Market regime</dt>
                <dd>{j?.regime?.choice ?? "—"}</dd>
                <dt>Setup assessment</dt>
                <dd>{j?.setup?.choice ?? "—"}</dd>
              </dl>
              <p className="fine">
                Model probabilities are unvalidated forecasts, not proven trade
                win probabilities.
              </p>
            </div>
          </aside>
        </div>
        <section className="indicator-grid">
          {cards.map(([k, v, n]) => (
            <article key={k}>
              <label>{k}</label>
              <strong>{v}</strong>
              <small>{n}</small>
            </article>
          ))}
        </section>
        <div className="lower-grid">
          <section className="panel">
            <div className="panel-title">
              <h2>Position</h2>
              <span className="tag">SPOT · LONG / CASH</span>
            </div>
            <div className="position-content">
              {p ? (
                <>
                  <strong className="mint">
                    LONG · {p.qty.toFixed(6)} {market}
                  </strong>
                  <p>
                    Entry {money(p.entry)} · {time(p.entryTime)}
                  </p>
                  <p>
                    Stop {money(p.stop)} · Target {money(p.target)}
                  </p>
                  <p>
                    Open P&L before exit costs{" "}
                    {money(p.qty * (data?.quote?.bid ?? p.entry) - p.cost)}
                  </p>
                </>
              ) : (
                <>
                  <strong>Holding virtual cash</strong>
                  <p className="muted">
                    A qualifying Jev bullish forecast can open a position.
                  </p>
                </>
              )}
            </div>
            <div className="position-content">
              <button
                className="secondary"
                disabled={!p || pending}
                onClick={() => void action("close")}
              >
                Close virtual position
              </button>
            </div>
          </section>
          <section className="panel">
            <div className="panel-title">
              <h2>Detected patterns</h2>
              <span className="tag">CALCULATED IN CODE</span>
            </div>
            <div className="position-content muted">
              {a ? (
                <>
                  <p>{time(a.time)}</p>
                  {a.patterns.length
                    ? a.patterns.map((pattern) => (
                        <span key={pattern} className="tag">
                          {pattern}
                        </span>
                      ))
                    : "No configured pattern on the latest closed candle."}
                  <p>
                    Prior 20-bar support {money(a.support)} · resistance{" "}
                    {money(a.resistance)}
                  </p>
                </>
              ) : (
                "Waiting for closed candles."
              )}
            </div>
          </section>
        </div>
        <section className="panel journal">
          <div className="panel-title">
            <div>
              <h2>Research journal</h2>
              <p>Every decision and fill, with its own timestamp.</p>
            </div>
            <div className="tabs" role="group" aria-label="Journal view">
              {(["decisions", "trades", "events"] as Tab[]).map((t) => (
                <button
                  key={t}
                  className={tab === t ? "active" : ""}
                  onClick={() => setTab(t)}
                >
                  {t === "events" ? "System" : t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {heads.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody id="tableBody">
                {rows.length ? (
                  rows.map((r, i) => (
                    <tr key={i}>
                      {r.map((cell, k) => (
                        <td
                          className={
                            k === r.length - 1 || k === 3 ? "detail" : undefined
                          }
                          key={k}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="empty" colSpan={heads.length}>
                      {tab === "trades"
                        ? "No virtual fills yet. Entries and exits will appear here and on the chart."
                        : tab === "decisions"
                          ? "No forecasts yet. Configure Jev and start paper trading to begin."
                          : "No system events yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <footer>
          <span>
            Paper simulation · 10% cash allocation · 0.10% fee + 0.05% slippage
            per side · 2% stop / 4% target
          </span>
          <span>
            {market} reference prices from Kraken. Solana network fees, DEX
            liquidity and swap costs are not modeled.
          </span>
          <span>
            Paused entries do not disable risk exits. Keep the paper engine
            running to monitor positions.
          </span>
          <span>
            Charts powered by{" "}
            <a
              href="https://www.tradingview.com/"
              target="_blank"
              rel="noreferrer"
            >
              TradingView Lightweight Charts™
            </a>
            . Copyright (c) 2026 TradingView, Inc.
          </span>
        </footer>
      </main>
    </>
  );
}
