import type { Decision } from "../src/types";
import test from "node:test";
import assert from "node:assert/strict";
import {
  initialState,
  enter,
  close,
  riskExit,
  validQuote,
  analyze,
  settleForecasts,
  validatePrediction,
} from "../src/engine";
const now = 1800000000000;
const decision = (): Decision => ({
  id: "test",
  candleTime: now,
  requestedAt: now,
  referencePrice: 100,
  promptVersion: 1,
  indicators: {
    time: now,
    close: 100,
    ema20: 100,
    ema50: 100,
    rsi: 50,
    atr: 2,
    support: 99,
    resistance: 101,
    volumeRatio: 1,
    patterns: [],
    trend: "up",
  },
  forecast: {
    choice: "up",
    confidence: 1,
    probabilities: { up: 1, down: 0, unclear: 0 },
  },
});
const quote = { bid: 99900, ask: 100000, time: now };
test("Round trip accounts for spread, adverse slippage and both fees", () => {
  const s = initialState();
  enter(s, quote, { id: "d1" }, now);
  assert.equal(s.cash, 9000);
  assert.equal(s.position!.entry, 100050);
  const p = s.position!;
  close(s, quote, "test", now);
  assert.equal(s.position, null);
  assert.ok(s.cash < 10000);
  assert.equal(
    s.trades[1].pnl,
    s.trades[1].qty * s.trades[1].price - s.trades[1].fee - p.cost,
  );
});
test("Stale prices and duplicate entries do not execute", () => {
  const s = initialState();
  assert.equal(enter(s, quote, { id: "d1" }, now + 31000), null);
  enter(s, quote, { id: "d1" }, now);
  assert.equal(enter(s, quote, { id: "d2" }, now), null);
  assert.equal(s.trades.length, 1);
  assert.equal(validQuote({ bid: 10, ask: 9, time: now }, now), false);
});
test("A stop fills at observed bid, including a gap below the trigger", () => {
  const s = initialState();
  enter(s, quote, { id: "d" }, now);
  const t = riskExit(
    s,
    { bid: 95000, ask: 95100, time: now + 1000 },
    now + 1000,
  );
  assert.ok(t);
  assert.equal(t.reason, "Stop triggered");
  assert.ok(t.price < 95000);
});
test("Forecasts resolve only after their future horizon", () => {
  const s = initialState();
  s.decisions = [decision()];
  settleForecasts(s, [{ time: now + 1700000, close: 105 }]);
  assert.equal(s.decisions[0].outcome, undefined);
  settleForecasts(s, [{ time: now + 1800000, close: 105 }]);
  assert.equal(s.decisions[0].outcome!.correct, true);
});
test("Indicators use supplied history; flat candles have neutral RSI", () => {
  const candles = Array.from({ length: 60 }, (_, i) => ({
    time: i * 300000,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 10,
  }));
  const a = analyze(candles);
  assert.equal(a.rsi, 50);
  assert.equal(a.ema20, 100);
  assert.equal(a.support, 99);
  assert.equal(a.resistance, 101);
  assert.equal(a.atr, 2);
});
test("Malformed model distributions are rejected", () => {
  assert.throws(() =>
    validatePrediction({
      choice: "up",
      confidence: 0.8,
      probabilities: { up: 0.8, down: 0.8, unclear: 0.2 },
    }),
  );
  assert.throws(() => validatePrediction({ choice: "buy", confidence: 1 }));
  assert.equal(
    validatePrediction({
      choice: "up",
      confidence: 0.8,
      probabilities: { up: 0.8, down: 0.1, unclear: 0.1 },
    }).choice,
    "up",
  );
});
test("A missing horizon candle is not silently replaced by a later price", () => {
  const s = initialState();
  s.decisions = [decision()];
  settleForecasts(s, [{ time: now + 3600000, close: 105 }]);
  assert.equal(s.decisions[0].outcome, undefined);
});
