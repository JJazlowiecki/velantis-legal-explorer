import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const getSessionCookieMock = vi.fn();
vi.mock("better-auth/cookies", () => ({ getSessionCookie: getSessionCookieMock }));

async function loadProxy() {
  const mod = await import("./proxy");
  return mod.proxy;
}

describe("proxy (route protection)", () => {
  it("redirects an unauthenticated request for a private /explorer route to /login", async () => {
    getSessionCookieMock.mockReturnValue(null);
    const proxy = await loadProxy();

    const request = new NextRequest(new URL("https://app.example.com/explorer"));
    const response = await proxy(request);

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("redirect")).toBe("/explorer");
  });

  it("redirects an unauthenticated request for a nested private route (e.g. /explorer/history) to /login with the original path preserved", async () => {
    getSessionCookieMock.mockReturnValue(null);
    const proxy = await loadProxy();

    const request = new NextRequest(new URL("https://app.example.com/explorer/history"));
    const response = await proxy(request);

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("redirect")).toBe("/explorer/history");
  });

  it("allows an authenticated request through to a private /explorer route", async () => {
    getSessionCookieMock.mockReturnValue("real-session-token");
    const proxy = await loadProxy();

    const request = new NextRequest(new URL("https://app.example.com/explorer/account"));
    const response = await proxy(request);

    // NextResponse.next() carries no redirect — status is the pass-through default (200).
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects an already-authenticated user away from /login back to /explorer", async () => {
    getSessionCookieMock.mockReturnValue("real-session-token");
    const proxy = await loadProxy();

    const request = new NextRequest(new URL("https://app.example.com/login"));
    const response = await proxy(request);

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/explorer");
  });

  it("allows an unauthenticated request through to /login", async () => {
    getSessionCookieMock.mockReturnValue(null);
    const proxy = await loadProxy();

    const request = new NextRequest(new URL("https://app.example.com/login"));
    const response = await proxy(request);

    expect(response.headers.get("location")).toBeNull();
  });
});
