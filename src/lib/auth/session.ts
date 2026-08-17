import "server-only";

import { headers } from "next/headers";

import { getAuth } from "@/lib/auth/auth";

export interface AuthenticatedUser {
  id: string;
  email: string;
  emailVerified: boolean;
}

/**
 * The ONE place server code asks "who is the caller". Identity is derived exclusively from
 * the Better Auth session cookie via the server SDK (`auth.api.getSession`) — never from a
 * client-supplied id, header, or form field. Returns null for no/invalid/expired session;
 * never throws for that case.
 */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const auth = getAuth();
  const result = await auth.api.getSession({ headers: await headers() });
  if (!result?.user) return null;
  return { id: result.user.id, email: result.user.email, emailVerified: result.user.emailVerified };
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "UnauthenticatedError";
  }
}

/** Throws UnauthenticatedError instead of returning null — for server actions/route handlers that must never proceed without a real session. */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  return user;
}
