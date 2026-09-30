import type {
  Candle,
  Quote,
  Indicators,
  Decision,
  Session,
  Trade,
  Forecast,
  Settings,
} from "./types";
import { z } from "zod";
export const SETTINGS: Settings = {
  initialCash: 10000,
  allocation: 0.1,
  feeBps: 10,
  slippageBps: 5,
  threshold: 0.65,
  stopPct: 0.02,
  targetPct: 0.04,
  maxHoldMs: 4 * 60 * 60 * 1000,
  intervalMinutes: 5,
};
export function initialState(): Session {
  return {
    version: 1,
    createdAt: Date.now(),
    cash: SETTINGS.initialCash,
    position: null,
    trades: [],
    decisions: [],
    lastCandle: 0,
  };
}
export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  return values.reduce((out, v, i) => {
    out.push(i ? v * k + out[i - 1] * (1 - k) : v);
    return out;
  }, [] as number[]);
}
export function analyze(candles: Candle[]): Indicators {
  if (candles.length < 60)
    throw new Error("At least 60 closed candles are required");
  const closes = candles.map((c) => c.close),
    fast = ema(closes, 20),
    slow = ema(closes, 50),
    last = candles.at(-1)!,
    prev = candles.at(-2)!;
  let gain = 0,
    loss = 0;
  for (let i = 1; i <= 14; i++) {
    const d = closes[i] - closes[i - 1];
    gain += Math.max(d, 0) / 14;
    loss += Math.max(-d, 0) / 14;
  }
  for (let i = 15; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * 13 + Math.max(d, 0)) / 14;
    loss = (loss * 13 + Math.max(-d, 0)) / 14;
  }
  const rsi =
    loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
  const tr = candles
    .slice(1)
    .map((c, i) =>
      Math.max(
        c.high - c.low,
        Math.abs(c.high - candles[i].close),
        Math.abs(c.low - candles[i].close),
      ),
    );
  let atr = tr.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
  for (const v of tr.slice(14)) atr = (atr * 13 + v) / 14;
  const window = candles.slice(-21, -1),
    support = Math.min(...window.map((c) => c.low)),
    resistance = Math.max(...window.map((c) => c.high));
  const meanVolume = window.reduce((s, c) => s + c.volume, 0) / window.length;
  const patterns: string[] = [];
  if (
    last.close > last.open &&
    prev.close < prev.open &&
    last.open <= prev.close &&
    last.close >= prev.open
  )
    patterns.push("Bullish engulfing");
  if (
    last.close < last.open &&
    prev.close > prev.open &&
    last.open >= prev.close &&
    last.close <= prev.open
  )
    patterns.push("Bearish engulfing");
  if (last.close > resistance) patterns.push("20-bar resistance breakout");
  if (last.close < support) patterns.push("20-bar support breakdown");
  if (fast.at(-1)! > slow.at(-1)! && fast.at(-2)! <= slow.at(-2)!)
    patterns.push("EMA 20 crosses above EMA 50");
  if (fast.at(-1)! < slow.at(-1)! && fast.at(-2)! >= slow.at(-2)!)
    patterns.push("EMA 20 crosses below EMA 50");
  if (rsi > 70) patterns.push("RSI above 70");
  if (rsi < 30) patterns.push("RSI below 30");
  return {
    time: last.time,
    close: last.close,
    ema20: fast.at(-1)!,
    ema50: slow.at(-1)!,
    rsi,
    atr,
    support,
    resistance,
    volumeRatio: meanVolume ? last.volume / meanVolume : 0,
    patterns,
    trend: fast.at(-1)! > slow.at(-1)! ? "up" : "down",
  };
}
export function validQuote(
  q: Quote | null | undefined,
  now = Date.now(),
): q is Quote {
  return Boolean(
    q &&
    Number.isFinite(q.bid) &&
    Number.isFinite(q.ask) &&
    q.bid > 0 &&
    q.ask >= q.bid &&
    now - q.time <= 30000 &&
    q.time <= now,
  );
}
export function enter(
  state: Session,
  quote: Quote,
  decision: Pick<Decision, "id">,
  now = Date.now(),
): Trade | null {
  if (state.position || !validQuote(quote, now)) return null;
  const budget = state.cash * SETTINGS.allocation,
    price = quote.ask * (1 + SETTINGS.slippageBps / 10000),
    fee = (budget * SETTINGS.feeBps) / 10000,
    qty = (budget - fee) / price;
  if (!(qty > 0)) return null;
  const trade: Trade = {
    id: crypto.randomUUID(),
    side: "entry",
    time: now,
    price,
    qty,
    fee,
    decisionId: decision.id,
    reason: "Jev bullish forecast",
    quote: { ...quote },
  };
  state.cash -= budget;
  state.position = {
    qty,
    entry: price,
    cost: budget,
    entryTime: now,
    stop: price * (1 - SETTINGS.stopPct),
    target: price * (1 + SETTINGS.targetPct),
    decisionId: decision.id,
  };
  state.trades.push(trade);
  return trade;
}
export function close(
  state: Session,
  quote: Quote,
  reason: string,
  now = Date.now(),
  decisionId: string | null = null,
): Trade | null {
  if (!state.position || !validQuote(quote, now)) return null;
  const p = state.position,
    price = quote.bid * (1 - SETTINGS.slippageBps / 10000),
    gross = p.qty * price,
    fee = (gross * SETTINGS.feeBps) / 10000,
    net = gross - fee;
  const trade: Trade = {
    id: crypto.randomUUID(),
    side: "exit",
    time: now,
    price,
    qty: p.qty,
    fee,
    pnl: net - p.cost,
    reason,
    decisionId,
    entryDecisionId: p.decisionId,
    entryTime: p.entryTime,
    quote: { ...quote },
  };
  state.cash += net;
  state.position = null;
  state.trades.push(trade);
  return trade;
}
export function riskExit(
  state: Session,
  quote: Quote,
  now = Date.now(),
): Trade | null {
  const p = state.position;
  if (!p || !validQuote(quote, now)) return null;
  const reason =
    quote.bid <= p.stop
      ? "Stop triggered"
      : quote.bid >= p.target
        ? "Target triggered"
        : now - p.entryTime >= SETTINGS.maxHoldMs
          ? "4-hour time exit"
          : null;
  return reason ? close(state, quote, reason, now) : null;
}
const forecastSchema = z
  .object({
    type: z.literal("choice").optional(),
    choice: z.enum(["up", "down", "unclear"]),
    confidence: z.number().min(0).max(1),
    probabilities: z.object({
      up: z.number().min(0).max(1),
      down: z.number().min(0).max(1),
      unclear: z.number().min(0).max(1),
    }),
  })
  .refine(
    (a) =>
      Math.abs(Object.values(a.probabilities).reduce((s, p) => s + p, 0) - 1) <=
      0.02,
    "Invalid probability distribution",
  );
export function validatePrediction(answer: unknown): Forecast {
  return forecastSchema.parse(answer);
}
export function settleForecasts(
  state: Session,
  candles: Pick<Candle, "time" | "close">[],
): void {
  for (const d of state.decisions) {
    if (d.outcome || d.error || !d.forecast) continue;
    const c = candles.find((c) => c.time === d.candleTime + 30 * 60 * 1000);
    if (c) {
      const change = c.close / d.referencePrice - 1;
      d.outcome = {
        time: c.time,
        close: c.close,
        returnPct: change * 100,
        direction: change > 0 ? "up" : change < 0 ? "down" : "flat",
        correct:
          d.forecast.choice === "unclear"
            ? null
            : d.forecast.choice === "up"
              ? change > 0
              : change < 0,
      };
    }
  }
}
