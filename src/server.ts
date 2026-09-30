import { sameSecret } from "./auth";
import type { ServerResponse } from "node:http";
import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createMarketEngine } from "./runtime";
import { MARKETS, parseMarket, type MarketSymbol } from "./markets";

const root = fileURLToPath(new URL("../", import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(root, "data");
const engines = {
  BTC: await createMarketEngine("BTC", dataDir),
  SOL: await createMarketEngine("SOL", dataDir),
};
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
    const url = new URL(req.url || "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/healthz")
      return json(res, { ok: true });
    if (
      apiToken &&
      !sameSecret(req.headers.authorization || "", `Bearer ${apiToken}`)
    )
      return json(res, { error: "Unauthorized" }, 401);
    const symbol = parseMarket(url.searchParams.get("market"));
    if (!symbol)
      return json(
        res,
        { error: "Unsupported market. Choose BTC or SOL." },
        400,
      );
    const engine = engines[symbol];
    if (req.method === "GET" && url.pathname === "/api/state") {
      const markets = (Object.keys(MARKETS) as MarketSymbol[]).map((symbol) => {
        const s = engines[symbol].snapshot();
        return {
          symbol,
          running: s.running,
          hasPosition: Boolean(s.state.position),
        };
      });
      return json(res, { ...engine.snapshot(), markets });
    }
    if (req.method === "GET" && url.pathname === "/api/export") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${symbol.toLowerCase()}-paper-session.json"`,
      });
      return res.end(JSON.stringify(engine.exportSession(), null, 2));
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
      if (url.pathname === "/api/start") {
        if (!process.env.TYPESAFE_API_KEY)
          return json(
            res,
            { error: "Configure TYPESAFE_API_KEY on the engine service." },
            400,
          );
        await engine.start();
        json(res, { ok: true, market: symbol });
        void engine.evaluate().catch(engine.fatal);
        return;
      }
      if (url.pathname === "/api/pause") {
        await engine.pause();
        return json(res, { ok: true, market: symbol });
      }
      if (url.pathname === "/api/close") {
        if (!engine.snapshot().state.position)
          return json(res, { error: "No open position" }, 400);
        await engine.closePosition();
        return json(res, { ok: true, market: symbol });
      }
    }
    json(res, { error: "Not found" }, 404);
  } catch (e) {
    json(res, { error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
server.listen(port, host, () =>
  console.log("Paper engine listening on " + host + ":" + port),
);
await Promise.all(Object.values(engines).map((engine) => engine.refresh()));
for (const engine of Object.values(engines))
  setInterval(
    () => void engine.refresh().then(engine.evaluate).catch(engine.fatal),
    15000,
  );
