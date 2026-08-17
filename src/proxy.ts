import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Server-side route protection — the FIRST line of defense (every private server
 * action/page also independently calls requireUser()/getCurrentUser(), see
 * src/lib/auth/session.ts, since Proxy alone is a UX convenience, never the sole
 * authorization boundary). This is a cheap cookie-presence check only (no DB hit, no
 * signature verification) — deliberately: Proxy runs on every request, so it must stay
 * fast; the real session validity check happens in the actual page/action via
 * `auth.api.getSession`. (Renamed from Next.js's `middleware.ts` convention, deprecated in
 * favor of `proxy.ts` as of this Next.js version — same NextRequest/NextResponse API.)
 */
const PRIVATE_PREFIXES = ["/explorer"];
const AUTH_ONLY_WHEN_SIGNED_OUT = ["/login", "/register"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request));

  const isPrivate = PRIVATE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (isPrivate && !hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const isAuthOnly = AUTH_ONLY_WHEN_SIGNED_OUT.some((path) => pathname === path);
  if (isAuthOnly && hasSession) {
    return NextResponse.redirect(new URL("/explorer", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/explorer/:path*", "/login", "/register"],
};
