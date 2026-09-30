# Deployment

The Next.js dashboard runs on Vercel. The engine runs as one always-on Docker service on a VPS, with a persistent volume. Vercel never starts the polling loop or stores portfolio files.

## Vercel

Import motiooon/AITradingBot as a Next.js project. Build command: `npm run build`.
Server-only environment variables:

- `DASHBOARD_USER`, `DASHBOARD_PASSWORD`: required for HTTP Basic login. Public deployments fail closed when unset.
- `ENGINE_URL`: HTTPS origin of the VPS engine, without an API path.
- `ENGINE_API_TOKEN`: random 32+ character shared secret; must match the VPS.

The Jev key belongs on the engine only. Do not prefix secrets with `NEXT_PUBLIC_`. Redeploy after editing environment variables. Until ENGINE_URL and its token are configured, the dashboard explicitly reports that the engine is not connected.

## VPS

1. Install Docker Compose and a TLS reverse proxy such as Caddy.
2. Clone the GitHub repository.
3. Copy `deploy/engine.env.example` to `deploy/engine.env`, fill the secrets, and restrict permissions: `chmod 600 deploy/engine.env`.
4. Run `docker compose up -d --build`. Keep exactly one engine replica per data volume.
5. Set an engine domain's DNS to the VPS, install the example Caddy site with the real domain, and allow HTTPS inbound. The engine port is bound to VPS localhost only.
6. Set the matching Vercel environment variables and redeploy the dashboard.
7. Sign into the dashboard and start paper trading. Docker restarts the engine after a crash or host reboot; AUTO_RESUME restores the saved start/pause preference. A fatal engine error saves a paused preference when possible.

`/healthz` is public and returns process liveness only. Every data/control endpoint requires the shared bearer token on a network-bound engine. TLS is provided by the VPS reverse proxy.

## Preserve existing history

Stop the local engine before a final copy of `data/session.json` and `data/audit.jsonl`. Stop the VPS engine, copy those files into its `paper-data` volume with ownership uid 1000, then restart. Never have two processes write the same volume. Historical decisions do not recreate missed trades while offline. Back up the data volume regularly. Postgres is not introduced by this deployment.

Use `docker compose logs --tail=100 engine` to inspect status. This setup does not prevent outages or guarantee fills. The deployed engine retains the tested 15-second polling cadence.

## Railway engine (managed alternative to a VPS)

1. Create a Railway service from this GitHub repository. `railway.json` selects `Dockerfile.engine` and starts only the engine.
2. Attach one persistent volume at `/app/data` **before starting paper trading**. Keep one replica. Enable volume backups in Railway.
3. Set `TYPESAFE_API_KEY`, `ENGINE_API_TOKEN` (32+ random characters), `API_HOST=0.0.0.0`, `API_PORT=3001`, `PORT=3001`, `DATA_DIR=/app/data`, `AUTO_RESUME=true`, and `RAILWAY_RUN_UID=0`. Railway's root-owned volume requires the last setting for this Docker image.
4. Disable Serverless/App Sleeping. Use an account plan that supports the required continuous service and restart policy.
5. Generate a Railway HTTPS domain targeting port 3001. Configure its origin as `ENGINE_URL` in Vercel and share only the engine token with Vercel. Keep the Jev key on Railway.
6. Verify `/healthz`, authenticated `/api/state`, and live candle updates. Start paper trading through the dashboard after moving the saved session, or explicitly begin a fresh portfolio.

Do not put any secret or local trading history in GitHub. Importing the repository into Railway without configuring its volume and environment variables does not complete deployment.
