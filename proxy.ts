import { NextRequest, NextResponse } from "next/server";
import { validBasicAuth } from "./src/auth";
export function proxy(request: NextRequest) {
  const user = process.env.DASHBOARD_USER,
    password = process.env.DASHBOARD_PASSWORD;
  if (!user || !password) {
    if (process.env.VERCEL)
      return new NextResponse("Dashboard access is not configured.", {
        status: 503,
      });
    return NextResponse.next();
  }
  if (!validBasicAuth(request.headers.get("authorization"), user, password))
    return new NextResponse("Sign in to Bitcoin Paper Lab", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Bitcoin Paper Lab", charset="UTF-8"',
        "Cache-Control": "no-store",
      },
    });
  return NextResponse.next();
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
