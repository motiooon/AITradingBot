import type { Market, MarketSymbol } from "./markets";
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export interface Quote {
  bid: number;
  ask: number;
  last?: number;
  time: number;
}
export interface Indicators {
  time: number;
  close: number;
  ema20: number;
  ema50: number;
  rsi: number;
  atr: number;
  support: number;
  resistance: number;
  volumeRatio: number;
  patterns: string[];
  trend: "up" | "down";
}
export interface Choice<T extends string = string> {
  type?: "choice";
  choice: T;
  confidence: number;
  probabilities: Record<T, number>;
}
export type Forecast = Choice<"up" | "down" | "unclear">;
export interface Decision {
  id: string;
  candleTime: number;
  requestedAt: number;
  receivedAt?: number;
  referencePrice: number;
  indicators: Indicators;
  promptVersion: number;
  forecast?: Forecast;
  regime?: Choice;
  setup?: Choice;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  action?: "hold" | "entry" | "exit" | "skipped";
  error?: string;
  outcome?: {
    time: number;
    close: number;
    returnPct: number;
    direction: "up" | "down" | "flat";
    correct: boolean | null;
  };
}
export interface Position {
  qty: number;
  entry: number;
  cost: number;
  entryTime: number;
  stop: number;
  target: number;
  decisionId: string;
}
export interface Trade {
  id: string;
  side: "entry" | "exit";
  time: number;
  price: number;
  qty: number;
  fee: number;
  pnl?: number;
  reason: string;
  decisionId: string | null;
  entryDecisionId?: string;
  entryTime?: number;
  quote: Quote;
}
export interface Session {
  market?: MarketSymbol;
  enabled?: boolean;
  version: 1;
  createdAt: number;
  cash: number;
  position: Position | null;
  trades: Trade[];
  decisions: Decision[];
  lastCandle: number;
}
export interface Settings {
  initialCash: number;
  allocation: number;
  feeBps: number;
  slippageBps: number;
  threshold: number;
  stopPct: number;
  targetPct: number;
  maxHoldMs: number;
  intervalMinutes: number;
}
export interface Snapshot {
  market: Market;
  markets?: { symbol: MarketSymbol; running: boolean; hasPosition: boolean }[];
  running: boolean;
  busy: boolean;
  keyConfigured: boolean;
  source: string;
  settings: Settings;
  candles: Candle[];
  formingCandle: Candle | null;
  quote: Quote | null;
  indicators: Indicators | null;
  error: string | null;
  updatedAt: number | null;
  events: { time: number; message: string; type: string }[];
  state: Session;
  metrics: {
    equity: number;
    netPnl: number;
    realized: number;
    closedTrades: number;
    winRate: number | null;
    forecastAccuracy: number | null;
    resolvedForecasts: number;
  };
}
