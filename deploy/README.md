# Railway deployment

One Railway project has two independently deployed services, both sourced from `motiooon/AITradingBot` on `main`.

## Engine

- Railway service settings: Dockerfile path `Dockerfile.engine`, start command `npm run engine`, healthcheck `/healthz` (120s), restart always.
- One replica; persistent volume mounted at `/app/data`; sleeping disabled.
- `API_HOST=::`, `API_PORT=3001`, `PORT=3001`, `AUTO_RESUME=true`, `RAILWAY_RUN_UID=0`.
- `DATA_DIR=/app/data/imported-session` for the existing migrated portfolio, or `/app/data` for a new installation.
- Secrets: `TYPESAFE_API_KEY`, `ENGINE_API_TOKEN` (random, 32+ characters).
- The engine's `RAILWAY_PRIVATE_DOMAIN` supplies its internal hostname. The dashboard uses it at port 3001.
- `/healthz` checks process liveness. Actual market health is reported in authenticated `/api/state`.

## Dashboard

- Railway service settings: Dockerfile path `Dockerfile.dashboard`, start command `node server.js`, healthcheck `/healthz` (120s), restart always, one replica, sleeping disabled. New Railway services no longer accept legacy JSON configuration files.
- No volume; one Next.js instance with a Railway public HTTPS domain targeting port 3000.
- `PORT=3000`, `DASHBOARD_REQUIRE_AUTH=true`.
- `ENGINE_URL=http://engine.railway.internal:3001` (use the engine's actual private domain).
- `ENGINE_API_TOKEN` matches the engine; `DASHBOARD_USER` and `DASHBOARD_PASSWORD` protect the UI and API with HTTP Basic authentication.
- `DASHBOARD_ORIGIN` is the exact public HTTPS origin and protects POST actions from cross-origin requests.
- The Jev API key belongs only on the engine. No secret is sent to browser code or GitHub.
- `/healthz` is public and confirms required runtime settings exist; data/control routes require login.

Pushes to GitHub deploy both connected services with their respective Dockerfiles. Build and runtime settings are configured separately on each Railway service; there is no shared root `railway.json` to override their Dockerfile paths. The engine resumes the persisted start/pause preference after restart. Use one engine replica per portfolio; do not scale file-based storage to multiple writers. Configure Railway volume backups. A persistent volume is not itself a backup.

## Local use

`npm run dev` runs both services locally. To inspect the cloud engine locally, put ENGINE_URL and ENGINE_API_TOKEN in `.env`, build, then run the Next.js dashboard alone. Avoid starting a second local trading session when comparing the cloud portfolio.

## Existing history

The original local history was copied into `/app/data/imported-session` on the Railway engine volume. That path must stay mounted and match DATA_DIR. Archive/export or back up the volume before changing it. Do not replace a live engine's portfolio files while it is writing.

## Multiple markets

The engine monitors BTC/USD and SOL/USD in the same process, each with independent session state and risk monitoring. Existing BTC files stay in DATA_DIR; SOL files live in DATA_DIR/SOL on the same persistent volume. Keep one engine replica for both portfolios. AUTO_RESUME restores each market's saved preference; SOL starts paused on first deployment. Dashboard market selection is local to the browser and does not alter another market's start/pause state.
