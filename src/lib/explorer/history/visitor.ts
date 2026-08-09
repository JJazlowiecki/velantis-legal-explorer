import "server-only";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Anonymous, server-managed visitor identity — the only ownership scope for /explorer
 * history until real auth exists. Deliberately just a bare UUID (not a foreign key, not
 * tied to any user table) so a future `user_id` can replace or absorb it later without
 * reshaping the history domain. Never readable by client JS (HttpOnly), never rendered in
 * the UI, and never included in any view model or API payload returned to the client.
 */
export const VISITOR_COOKIE_NAME = "explorer_visitor_id";

const VISITOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Read-only lookup — safe to call from Server Components (which cannot set cookies). Returns
 * null when no visitor cookie exists yet (a brand-new visitor who has never written history).
 */
export async function getVisitorId(): Promise<string | null> {
  const store = await cookies();
  return store.get(VISITOR_COOKIE_NAME)?.value ?? null;
}

/**
 * Read-or-create — only callable from a context that can mutate cookies (Server Actions or
 * Route Handlers). Generates a cryptographically random UUID and sets it HttpOnly, SameSite=Lax,
 * Secure in production, on first write.
 */
export async function getOrCreateVisitorId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(VISITOR_COOKIE_NAME)?.value;
  if (existing) {
    return existing;
  }

  const visitorId = randomUUID();
  store.set(VISITOR_COOKIE_NAME, visitorId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: VISITOR_COOKIE_MAX_AGE_SECONDS,
  });
  return visitorId;
}
