# Bitcoin Paper Lab

Next.js + React + TypeScript dashboard and a separate Node.js/TypeScript paper engine for paper trading with live BTC/USD candles, TypeSafe Jev forecasts, chart entry/exit markers, technical indicators, and a timestamped journal. No wallet, exchange credentials, real orders, or Solana transactions are implemented.

## Run

Requires Node.js 22 or later. Install dependencies with `npm install`.

1. Copy `.env.example` to `.env` if `.env` does not exist.
2. Set `TYPESAFE_API_KEY` locally in `.env`. Never commit or share it. Optionally pin `TYPESAFE_MODEL` to a supported model version for repeatable experiments.
3. Run `npm run dev` and open http://127.0.0.1:3000.
4. Click **Start paper trading**. Without a key, live charts and indicators still work; no fabricated Jev answers or trades are substituted.

Jev API calls consume your TypeSafe API allowance. At most one request per new five-minute candle while enabled (up to 288/day). Errors are recorded; a failed candle is not retried automatically. Both services bind only to localhost: Next.js on port 3000 and the engine on port 3001. Next.js proxies `/api/*` to the engine. Keep it running for data collection and risk exits. Entries start paused by default; the Railway deployment uses `AUTO_RESUME=true` to restore the saved start/pause preference.

## Simulation rules

- Kraken public BTC/USD REST candles, excluding the uncommitted final candle; poll every 15 seconds. Candle timestamps represent UTC closes.
- Jev receives the latest 60 closed candles, computed indicators, and a 30-minute directional forecast question. Forecasts, model version, full inputs, question definitions and receipt times are audited.
- Bullish forecast with answer confidence >= 0.65 enters a virtual long using 10% of available cash. Bearish forecast at that threshold exits. Other answers hold. This threshold is a research default, not validated profitability or a win probability.
- Fill at a freshly fetched ask/bid after inference, with 5 bps adverse slippage and 10 bps fee per side. No same-candle historical fill assumption.
- Stop at 2%, target at 4%, maximum hold 4 hours, evaluated at observed quotes. Stops can fill beyond their trigger. Polling can miss intrapoll moves. Pausing blocks model entries/exits, but risk exits remain active.
- Long/cash only. Equity marks open BTC at bid and does not deduct hypothetical exit costs. Closed-trade P&L includes entry and exit costs.
- Forecast accuracy resolves at the closed candle exactly 30 minutes after the signal (missing horizon candles remain unresolved). Unclear forecasts are excluded. This metric is distinct from trading win rate and is not proof of future predictive skill.
- EMA seeded from available history; RSI and ATR use Wilder smoothing. Defined patterns: engulfing, 20-bar breakout/breakdown, EMA crossover, RSI extremes. This is not an exhaustive pattern detector.

## Data

`data/session.json` persists portfolio, decisions and fills using atomic replacement. `data/audit.jsonl` stores input snapshots and questions per call. Export the session from the dashboard. No API secrets enter these files. Recent system events are in memory. Back up data before manually starting a fresh experiment.

The chart uses TradingView Lightweight Charts with candles, volume, EMA overlays, crosshair, zoom/pan, live price line, trade markers and position levels. The forming candle is displayed but excluded from decisions. Chart timestamps are UTC candle opens; decision timestamps are UTC candle closes.

The chart is a BTC reference-market simulation, not cbBTC/USDC execution. It does not model Solana gas, route availability, wrapper tracking differences, liquidity impact for actual order sizes, or wallet transactions. Historical replay/backtesting is not implemented: this version is forward paper trading with timestamps. Network outages interrupt observation; it cannot recreate missed fills while offline.

## Verify

`npm test` tests accounting, stale-quote rejection, stop gaps, forecast horizons, indicators and model response validation. `npm run check` checks strict TypeScript; `npm run build` verifies the production Next.js build. Run `npm start` after building for production. Actual Jev connectivity requires a valid user API key.

Reference: https://docs.typesafe.ai/api and https://docs.kraken.com/api-reference/market-data/get-ohlc-data

## Stack

Next.js App Router + React + strict TypeScript, TradingView Lightweight Charts, Node.js HTTP API, Zod validation. Next.js uses its own bundler; Vite is not used alongside Next.js. The trading engine is independent of browser refreshes and Next.js hot reload.

## Deploy from GitHub

Both services run in the same Railway project. The engine uses `railway.json` and `Dockerfile.engine`; the dashboard uses `Dockerfile.dashboard` with build/start settings configured on Railway. Dashboard traffic reaches the engine over Railway private networking. See [deployment instructions](deploy/README.md). No Vercel account is needed.
