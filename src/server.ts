import { sameSecret } from "./auth";
import type {
  Candle,
  Quote,
  Indicators,
  Session,
  Decision,
  Snapshot,
} from "./types";
import type { ServerResponse } from "node:http";
import http from "node:http";
import {
  readFile,
  writeFile,
  rename,
  mkdir,
  appendFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
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
const root = fileURLToPath(new URL("../", import.meta.url)),
  dataDir = process.env.DATA_DIR || path.join(root, "data");
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
    const [q, history] = await Promise.all([getQuote(), getCandles()]);
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
  const last = candles.at(-1)!;
  if (last.time <= state.lastCandle || Date.now() - last.time > 360000) return;
  busy = true;
  state.lastCandle = last.time;
  const d: Decision = {
    id: crypto.randomUUID(),
    candleTime: last.time,
    requestedAt: Date.now(),
    referencePrice: last.close,
    indicators: structuredClone(indicators),
    promptVersion: 1,
  };
  const input = {
    market: "Kraken BTC/USD reference; spot paper trading",
    intervalMinutes: 5,
    candleTimestampMeaning: "UTC candle close",
    horizonMinutes: 30,
    referencePrice: last.close,
    indicators: d.indicators,
    candles: candles.slice(-60),
  };
  try {
    await save();
    const result = await predict(input);
    d.receivedAt = Date.now();
    d.forecast = result.answers.forecast;
    d.regime = result.answers.regime;
    d.setup = result.answers.setup;
    d.model = result.model;
    d.usage = result.usage;
    // Fetch a new executable quote after inference: never fill retrospectively at the signal candle.
    const fresh = await getQuote();
    quote = fresh;
    d.action = "hold";
    if (running && validQuote(fresh) && Date.now() - d.requestedAt <= 60000) {
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
    source: "Kraken BTC/USD",
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
const port = Number(process.env.API_PORT || 3001);
const host = process.env.API_HOST || "127.0.0.1";
const apiToken = process.env.ENGINE_API_TOKEN;
if (
  !["127.0.0.1", "localhost", "::1"].includes(host) &&
  (!apiToken || apiToken.length < 32)
)
  throw new Error(
    "A network-bound engine requires ENGINE_API_TOKEN of at least 32 characters",
  );
const frontendPort = Number(process.env.PORT || 3000);
function json(res: ServerResponse, body: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/healthz")
      return json(res, { ok: true });
    if (
      apiToken &&
      !sameSecret(req.headers.authorization || "", `Bearer ${apiToken}`)
    )
      return json(res, { error: "Unauthorized" }, 401);
    if (req.method === "GET" && req.url === "/api/state")
      return json(res, snapshot());
    if (req.method === "GET" && req.url === "/api/export") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Disposition":
          'attachment; filename="bitcoin-paper-session.json"',
      });
      return res.end(JSON.stringify({ settings: SETTINGS, ...state }, null, 2));
    }
    if (req.method === "POST") {
      const origin = req.headers.origin;
      if (
        origin &&
        ![
          "http://127.0.0.1:" + frontendPort,
          "http://localhost:" + frontendPort,
        ].includes(origin)
      )
        return json(res, { error: "Local requests only" }, 403);
      if (req.url === "/api/start") {
        if (!process.env.TYPESAFE_API_KEY)
          return json(
            res,
            { error: "Add TYPESAFE_API_KEY to .env and restart the server." },
            400,
          );
        running = true;
        state.enabled = true;
        await save();
        log("Paper session started");
        json(res, { ok: true });
        void evaluate().catch(fatal);
        return;
      }
      if (req.url === "/api/pause") {
        running = false;
        state.enabled = false;
        await save();
        log("Entries paused; existing position risk exits remain active");
        return json(res, { ok: true });
      }
      if (req.url === "/api/close") {
        if (!state.position)
          return json(res, { error: "No open position" }, 400);
        const q = await getQuote();
        if (!close(state, q, "Manual virtual exit"))
          return json(res, { error: "Quote unavailable" }, 503);
        quote = q;
        await save();
        return json(res, { ok: true });
      }
    }
    json(res, { error: "Not found" }, 404);
  } catch (e) {
    json(res, { error: errorMessage(e) }, 500);
  }
});
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error";
}
function fatal(e: unknown) {
  running = false;
  state.enabled = false;
  void save().catch(() => {});
  error = "Session paused: " + errorMessage(e);
  log(error, "error");
  console.error(error);
}
server.listen(port, host, () =>
  console.log("Paper engine API http://127.0.0.1:" + port),
);
await refresh();
setInterval(() => refresh().then(evaluate).catch(fatal), 15000);
