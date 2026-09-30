import { MARKETS, type MarketSymbol } from "./markets";
import { z } from "zod";
import type { Candle, Quote } from "./types";
import { validatePrediction } from "./engine";
async function kraken(path: string): Promise<Record<string, unknown>> {
  const r = await fetch("https://api.kraken.com/0/public/" + path, {
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error("Market data HTTP " + r.status);
  const body = z
    .object({
      error: z.array(z.string()).optional(),
      result: z.record(z.string(), z.unknown()).optional(),
    })
    .parse(await r.json());
  if (body.error?.length) throw new Error(body.error.join(", "));
  if (!body.result) throw new Error("Missing market result");
  return body.result;
}
const numeric = z.coerce.number().finite();
export async function getQuote(symbol: MarketSymbol = "BTC"): Promise<Quote> {
  const result = await kraken("Ticker?pair=" + MARKETS[symbol].krakenPair),
    r = z
      .object({
        b: z.array(numeric).min(1),
        a: z.array(numeric).min(1),
        c: z.array(numeric).min(1),
      })
      .parse(Object.values(result)[0]);
  return { bid: r.b[0], ask: r.a[0], last: r.c[0], time: Date.now() };
}
export async function getCandles(symbol: MarketSymbol = "BTC"): Promise<{
  closed: Candle[];
  forming: Candle | null;
}> {
  const result = await kraken(
    "OHLC?pair=" + MARKETS[symbol].krakenPair + "&interval=5",
  );
  const entry = Object.entries(result).find(([k]) => k !== "last");
  if (!entry) throw new Error("Missing candle data");
  const rows = z.array(z.array(numeric).min(8)).parse(entry[1]);
  const all = rows.map((r) => ({
    time: r[0] * 1000 + 300000,
    open: r[1],
    high: r[2],
    low: r[3],
    close: r[4],
    volume: r[6],
  }));
  return {
    closed: all.slice(0, -1).filter((c) => c.time <= Date.now()),
    forming: all.at(-1) ?? null,
  };
}
export const questions = {
  forecast: {
    type: "choice",
    instructions:
      "Using only the supplied closed candles and indicators, forecast the price direction of the asset identified in `market` over the next 30 minutes relative to the last closed candle. This is an experimental forecast, not established predictive skill. Use unclear when evidence conflicts or is insufficient.",
    criteria: {
      up: "Price is expected to end above the reference close.",
      down: "Price is expected to end below the reference close.",
      unclear: "No sufficiently clear directional expectation.",
    },
  },
  regime: {
    type: "choice",
    instructions:
      "Classify market structure from the supplied candles and indicators.",
    criteria: {
      uptrend: "Higher prices with upward trend evidence.",
      downtrend: "Lower prices with downward trend evidence.",
      range: "Sideways movement without directional persistence.",
      unclear: "Mixed or insufficient evidence.",
    },
  },
  setup: {
    type: "choice",
    instructions:
      "Which technical setup is best supported by the supplied evidence? Do not invent a pattern.",
    criteria: {
      breakout: "Close beyond prior resistance with supporting volume.",
      pullback: "Retracement within an established uptrend.",
      breakdown: "Close below prior support.",
      reversal: "Evidence of a directional reversal.",
      none: "No clearly supported setup.",
    },
  },
};
export async function predict(input: unknown) {
  const response = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.TYPESAFE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.TYPESAFE_MODEL || "jev-latest",
      state: input,
      questions,
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok)
    throw new Error("Jev HTTP " + response.status + "; no new entry placed");
  const choice = z.object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: z.number().min(0).max(1),
    probabilities: z.record(z.string(), z.number().min(0).max(1)),
  });
  const data = z
    .object({
      model: z.string(),
      answers: z.object({
        forecast: z.unknown(),
        regime: choice,
        setup: choice,
      }),
      usage: z
        .object({
          input_tokens: z.number().optional(),
          output_tokens: z.number().optional(),
        })
        .optional(),
    })
    .parse(await response.json());
  return {
    ...data,
    answers: {
      ...data.answers,
      forecast: validatePrediction(data.answers.forecast),
    },
  };
}
