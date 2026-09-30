import type {
  Candle,
  Quote,
  Indicators,
  Session,
  Decision,
  Snapshot,
} from "./types";
import {
  readFile,
  writeFile,
  rename,
  mkdir,
  appendFile,
} from "node:fs/promises";
import path from "node:path";
import {
  SETTINGS,
  initialState,
  analyze,
  enter,
  close,
  riskExit,
  validQuote,
  settleForecasts,
} from "./engine";
import { getCandles, getQuote, predict, questions } from "./providers";
import { MARKETS, type MarketSymbol } from "./markets";

export async function createMarketEngine(
  symbol: MarketSymbol,
  rootDir: string,
  providers = { getCandles, getQuote, predict },
) {
  // Preserve the original Bitcoin files in place. New markets use their own directories.
  const dataDir = symbol === "BTC" ? rootDir : path.join(rootDir, symbol);
  await mkdir(dataDir, { recursive: true });
  let state: Session;
  try {
    state = JSON.parse(
      await readFile(path.join(dataDir, "session.json"), "utf8"),
    );
    if (
      state.version !== 1 ||
      !Array.isArray(state.trades) ||
      !Number.isFinite(state.cash)
    )
      throw new Error("Unsupported or invalid session file");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") state = initialState();
    else throw e;
  }
  if (state.market && state.market !== symbol)
    throw new Error("Session market does not match " + symbol);
  if (!state.market && symbol !== "BTC" && state.decisions.length)
    throw new Error("Untagged history may only be loaded as BTC");
  state.market = symbol;
  let controlVersion = 0;
  let running = process.env.AUTO_RESUME === "true" && state.enabled === true,
    busy = false,
    marketBusy = false;
  let candles: Candle[] = [];
  let formingCandle: Candle | null = null;
  let quote: Quote | null = null;
  let indicators: Indicators | null = null;
  let error: string | null = null;
  let updatedAt: number | null = null;
  const events: Snapshot["events"] = [];
  function log(message: string, type = "info") {
    events.unshift({ time: Date.now(), message, type });
    events.splice(100);
  }
  let persistQueue = Promise.resolve();
  function save() {
    const json = JSON.stringify(state, null, 2);
    persistQueue = persistQueue.then(async () => {
      await writeFile(path.join(dataDir, "session.tmp"), json);
      await rename(
        path.join(dataDir, "session.tmp"),
        path.join(dataDir, "session.json"),
      );
    });
    return persistQueue;
  }
  async function refresh() {
    if (marketBusy) return;
    marketBusy = true;
    try {
      const [q, history] = await Promise.all([
        providers.getQuote(symbol),
        providers.getCandles(symbol),
      ]);
      const c = history.closed;
      formingCandle = history.forming;
      if (!validQuote(q) || c.length < 60)
        throw new Error("Invalid or insufficient market data");
      quote = q;
      candles = c;
      indicators = analyze(c);
      updatedAt = Date.now();
      error = null;
      const exit = riskExit(state, quote);
      if (exit) log(exit.reason + " · virtual exit", "trade");
      settleForecasts(state, candles);
      await save();
    } catch (e) {
      error = errorMessage(e);
      log(errorMessage(e), "error");
    } finally {
      marketBusy = false;
    }
  }
  async function evaluate() {
    if (
      !running ||
      busy ||
      error ||
      !validQuote(quote) ||
      !candles.length ||
      !indicators
    )
      return;
    const version = controlVersion;
    const last = candles.at(-1)!;
    if (last.time <= state.lastCandle || Date.now() - last.time > 360000)
      return;
    busy = true;
    state.lastCandle = last.time;
    const d: Decision = {
      id: crypto.randomUUID(),
      candleTime: last.time,
      requestedAt: Date.now(),
      referencePrice: last.close,
      indicators: structuredClone(indicators),
      promptVersion: 2,
    };
    const input = {
      market: `Kraken ${MARKETS[symbol].pair} reference; spot paper trading`,
      intervalMinutes: 5,
      candleTimestampMeaning: "UTC candle close",
      horizonMinutes: 30,
      referencePrice: last.close,
      indicators: d.indicators,
      candles: candles.slice(-60),
    };
    try {
      await save();
      const result = await providers.predict(input);
      d.receivedAt = Date.now();
      d.forecast = result.answers.forecast;
      d.regime = result.answers.regime;
      d.setup = result.answers.setup;
      d.model = result.model;
      d.usage = result.usage;
      // Fetch a new executable quote after inference: never fill retrospectively at the signal candle.
      const fresh = await providers.getQuote(symbol);
      quote = fresh;
      d.action = "hold";
      if (
        running &&
        version === controlVersion &&
        validQuote(fresh) &&
        Date.now() - d.requestedAt <= 60000
      ) {
        if (
          state.position &&
          d.forecast.choice === "down" &&
          d.forecast.confidence >= SETTINGS.threshold
        ) {
          close(state, fresh, "Jev bearish forecast", Date.now(), d.id);
          d.action = "exit";
        } else if (
          !state.position &&
          d.forecast.choice === "up" &&
          d.forecast.confidence >= SETTINGS.threshold
        ) {
          enter(state, fresh, d);
          d.action = "entry";
        }
      } else d.action = "skipped";
      log("Jev " + d.forecast.choice + " · " + d.action, "decision");
    } catch (e) {
      d.error = errorMessage(e);
      d.receivedAt = Date.now();
      log(errorMessage(e), "error");
    } finally {
      state.decisions.push(d);
      await appendFile(
        path.join(dataDir, "audit.jsonl"),
        JSON.stringify({ decision: d, input, questions }) + "\n",
      );
      await save();
      busy = false;
    }
  }
  function snapshot(): Snapshot {
    const mark = quote?.bid ?? state.position?.entry ?? 0;
    const equity = state.cash + (state.position?.qty ?? 0) * mark;
    const exits = state.trades.filter((t) => t.side === "exit");
    const resolved = state.decisions.filter(
      (d) => d.outcome?.correct !== null && d.outcome?.correct !== undefined,
    );
    return {
      running,
      busy,
      keyConfigured: Boolean(process.env.TYPESAFE_API_KEY),
      market: MARKETS[symbol],
      source: "Kraken " + MARKETS[symbol].pair,
      settings: SETTINGS,
      candles,
      formingCandle,
      quote,
      indicators,
      error,
      updatedAt,
      events,
      state,
      metrics: {
        equity,
        netPnl: equity - SETTINGS.initialCash,
        realized: exits.reduce((a, t) => a + (t.pnl ?? 0), 0),
        closedTrades: exits.length,
        winRate: exits.length
          ? exits.filter((t) => (t.pnl ?? 0) > 0).length / exits.length
          : null,
        forecastAccuracy: resolved.length
          ? resolved.filter((d) => d.outcome?.correct).length / resolved.length
          : null,
        resolvedForecasts: resolved.length,
      },
    };
  }
  async function start() {
    running = true;
    state.enabled = true;
    controlVersion++;
    await save();
    log("Paper session started");
  }
  async function pause() {
    running = false;
    state.enabled = false;
    controlVersion++;
    await save();
    log("Entries paused; existing position risk exits remain active");
  }
  async function closePosition() {
    if (!state.position) throw new Error("No open position");
    controlVersion++;
    const q = await providers.getQuote(symbol);
    if (!close(state, q, "Manual virtual exit"))
      throw new Error("Quote unavailable");
    quote = q;
    await save();
  }
  function fatal(e: unknown) {
    running = false;
    state.enabled = false;
    void save().catch(() => {});
    error = "Session paused: " + errorMessage(e);
    log(error, "error");
    console.error(symbol + ": " + error);
  }
  return {
    snapshot,
    start,
    pause,
    closePosition,
    refresh,
    evaluate,
    fatal,
    exportSession: () => ({ market: symbol, settings: SETTINGS, ...state }),
  };
}
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error";
}
