import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMarketEngine } from "../src/runtime";
import { initialState } from "../src/engine";
import { parseMarket, type MarketSymbol } from "../src/markets";
import { getQuote, getCandles, questions } from "../src/providers";

function fixture() {
  const prices = { BTC: 80000, SOL: 150 };
  const requests: string[] = [];
  const inputs: unknown[] = [];
  let release: (() => void) | undefined;
  let block = false;
  const providers = {
    getQuote: async (symbol: MarketSymbol = "BTC") => {
      requests.push(symbol);
      return {
        bid: prices[symbol],
        ask: prices[symbol] * 1.0001,
        time: Date.now(),
      };
    },
    getCandles: async (symbol: MarketSymbol = "BTC") => ({
      closed: Array.from({ length: 60 }, (_, i) => ({
        time: Math.floor(Date.now() / 300000) * 300000 - (59 - i) * 300000,
        open: prices[symbol],
        close: prices[symbol],
        high: prices[symbol] * 1.01,
        low: prices[symbol] * 0.99,
        volume: 100,
      })),
      forming: null,
    }),
    predict: async (input: unknown) => {
      inputs.push(input);
      if (block)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      const forecast = {
        type: "choice" as const,
        choice: "up" as const,
        confidence: 0.9,
        probabilities: { up: 0.9, down: 0.05, unclear: 0.05 },
      };
      return {
        model: "test-model",
        answers: { forecast, regime: forecast, setup: forecast },
      };
    },
  };
  return {
    prices,
    requests,
    inputs,
    providers,
    block: () => {
      block = true;
    },
    release: () => {
      assert.ok(release);
      release();
    },
    isWaiting: () => Boolean(release),
  };
}
test("market allowlist defaults legacy URLs to BTC and rejects invalid symbols", () => {
  assert.equal(parseMarket(null), "BTC");
  assert.equal(parseMarket("SOL"), "SOL");
  for (const value of ["", "ETH", "../BTC", "sol", "__proto__"])
    assert.equal(parseMarket(value), null);
});
test("BTC legacy history survives; SOL fills, risk exits, audits and restart stay isolated", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "paper-markets-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const previousResume = process.env.AUTO_RESUME;
  process.env.AUTO_RESUME = "true";
  t.after(() => {
    if (previousResume === undefined) delete process.env.AUTO_RESUME;
    else process.env.AUTO_RESUME = previousResume;
  });
  const legacy = {
    ...initialState(),
    cash: 9876,
    enabled: true,
    lastCandle: 123,
  };
  await writeFile(path.join(dir, "session.json"), JSON.stringify(legacy));
  const f = fixture();
  const btc = await createMarketEngine("BTC", dir, f.providers);
  const sol = await createMarketEngine("SOL", dir, f.providers);
  assert.equal(btc.snapshot().running, true);
  assert.equal(btc.snapshot().state.cash, 9876);
  assert.equal(sol.snapshot().running, false);
  assert.equal(sol.snapshot().state.cash, 10000);
  await Promise.all([btc.refresh(), sol.refresh()]);
  await sol.start();
  await sol.evaluate();
  assert.equal(sol.snapshot().state.trades.length, 1);
  assert.ok(sol.snapshot().state.position!.qty > 6);
  assert.equal(btc.snapshot().state.trades.length, 0);
  assert.equal(btc.snapshot().state.cash, 9876);
  assert.match(JSON.stringify(f.inputs[0]), /SOL\/USD/);
  assert.doesNotMatch(JSON.stringify(f.inputs[0]), /BTC/);
  assert.equal(sol.snapshot().state.decisions[0].promptVersion, 2);
  const audit = JSON.parse(
    (await readFile(path.join(dir, "SOL/audit.jsonl"), "utf8")).trim(),
  );
  assert.match(audit.input.market, /SOL/);
  assert.doesNotMatch(questions.forecast.instructions, /BTC/);
  await sol.pause();
  assert.equal(btc.snapshot().running, true);
  f.prices.SOL = 140;
  await sol.refresh();
  assert.equal(sol.snapshot().state.position, null);
  assert.equal(sol.snapshot().state.trades[1].reason, "Stop triggered");
  assert.equal(sol.exportSession().market, "SOL");
  const restoredSol = await createMarketEngine("SOL", dir, f.providers);
  const restoredBtc = await createMarketEngine("BTC", dir, f.providers);
  assert.equal(restoredSol.snapshot().running, false);
  assert.equal(restoredSol.snapshot().state.trades.length, 2);
  assert.equal(restoredBtc.snapshot().running, true);
  assert.equal(restoredBtc.snapshot().state.cash, 9876);
  assert.equal(restoredBtc.snapshot().state.lastCandle, 123);
  const btcFile = JSON.parse(
    await readFile(path.join(dir, "session.json"), "utf8"),
  );
  assert.equal(btcFile.market, "BTC");
});
test("pausing while Jev is in flight prevents a late entry after resume", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "paper-inflight-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = fixture();
  const sol = await createMarketEngine("SOL", dir, f.providers);
  await sol.refresh();
  await sol.start();
  f.block();
  const evaluation = sol.evaluate();
  for (let i = 0; i < 100 && !f.isWaiting(); i++)
    await new Promise((r) => setTimeout(r, 5));
  assert.ok(f.isWaiting());
  await sol.pause();
  await sol.start();
  f.release();
  await evaluation;
  assert.equal(sol.snapshot().state.trades.length, 0);
  assert.equal(sol.snapshot().state.decisions[0].action, "skipped");
});
test("provider fetches SOL and BTC quotes/candles using the matching Kraken pair", async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    const price = url.includes("SOLUSD") ? 150 : 80000;
    const result = url.includes("Ticker")
      ? {
          pair: {
            b: [String(price)],
            a: [String(price + 0.01)],
            c: [String(price)],
          },
        }
      : {
          pair: [
            [100, price, price, price, price, price, 10, 1],
            [400, price, price, price, price, price, 10, 1],
          ],
          last: 400,
        };
    return Response.json({ error: [], result });
  });
  assert.equal((await getQuote("SOL")).bid, 150);
  assert.equal((await getQuote("BTC")).bid, 80000);
  assert.equal((await getCandles("SOL")).closed[0].close, 150);
  assert.equal((await getCandles("BTC")).closed[0].close, 80000);
  assert.equal(urls.filter((u) => u.includes("pair=SOLUSD")).length, 2);
  assert.equal(urls.filter((u) => u.includes("pair=XBTUSD")).length, 2);
});
