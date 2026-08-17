"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Client-side Better Auth instance for login/register/forgot-reset forms (see
 * src/components/auth/*). No Stripe client plugin here — Checkout/Portal are server actions
 * (src/lib/billing/actions.ts), never called from the browser, per this milestone's
 * "Stripe client server-side only" requirement.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession, requestPasswordReset, resetPassword } = authClient;
