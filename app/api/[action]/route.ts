import { NextRequest } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function forward(
  request: NextRequest,
  context: { params: Promise<{ action: string }> },
) {
  const { action } = await context.params;
  const allowed =
    request.method === "GET"
      ? ["state", "export"]
      : ["start", "pause", "close"];
  if (!allowed.includes(action))
    return Response.json({ error: "Not found" }, { status: 404 });
  if (request.method === "POST") {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin)
      return Response.json(
        { error: "Cross-origin action rejected" },
        { status: 403 },
      );
  }
  const configured = process.env.ENGINE_URL;
  if (process.env.VERCEL && (!configured || !process.env.ENGINE_API_TOKEN))
    return Response.json(
      {
        error:
          "VPS engine is not connected yet. Configure ENGINE_URL and ENGINE_API_TOKEN in Vercel.",
      },
      { status: 503 },
    );
  const base = configured || `http://127.0.0.1:${process.env.API_PORT || 3001}`;
  try {
    const url = new URL(base);
    if (process.env.VERCEL && url.protocol !== "https:")
      throw new Error("Engine must use HTTPS");
    const response = await fetch(new URL("/api/" + action, url), {
      method: request.method,
      headers: process.env.ENGINE_API_TOKEN
        ? { Authorization: `Bearer ${process.env.ENGINE_API_TOKEN}` }
        : {},
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    const headers = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    if (action === "export")
      headers.set(
        "Content-Disposition",
        'attachment; filename="bitcoin-paper-session.json"',
      );
    return new Response(await response.text(), {
      status: response.status,
      headers,
    });
  } catch {
    return Response.json(
      {
        error:
          "Trading engine is unreachable. Monitoring requires the VPS service to be running.",
      },
      { status: 502 },
    );
  }
}
export const GET = forward;
export const POST = forward;
