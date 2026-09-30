export const dynamic = "force-dynamic";
export function GET() {
  const ready = Boolean(
    process.env.DASHBOARD_USER &&
    process.env.DASHBOARD_PASSWORD &&
    process.env.ENGINE_URL &&
    process.env.ENGINE_API_TOKEN,
  );
  return Response.json(
    { ok: ready },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
