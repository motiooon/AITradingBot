export const MARKETS = {
  BTC: {
    symbol: "BTC",
    name: "Bitcoin",
    pair: "BTC/USD",
    krakenPair: "XBTUSD",
  },
  SOL: { symbol: "SOL", name: "Solana", pair: "SOL/USD", krakenPair: "SOLUSD" },
} as const;
export type MarketSymbol = keyof typeof MARKETS;
export type Market = (typeof MARKETS)[MarketSymbol];
export function parseMarket(value: string | null): MarketSymbol | null {
  if (value === null) return "BTC";
  return value === "BTC" || value === "SOL" ? value : null;
}
