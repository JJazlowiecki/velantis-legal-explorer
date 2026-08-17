import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { stripe } from "@better-auth/stripe";
import Stripe from "stripe";

import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { getServerEnv } from "@/lib/env/server";
import { PLANS } from "@/lib/billing/plans";
import { resetPasswordEmail, verificationEmail } from "@/lib/mail/templates";
import { sendMail } from "@/lib/mail/send";

/**
 * The single Better Auth server instance for the app — email/password auth, database-backed
 * rate limiting, and (when Stripe env is present) the `@better-auth/stripe` subscription
 * plugin. No social login, no organizations/teams (explicitly out of scope for this
 * milestone). `secret`/`baseURL` are the only production-required pieces; everything else
 * degrades safely when unconfigured (see src/lib/billing/plans.ts's isBillingConfigured and
 * src/lib/mail/send.ts's "not_configured" result).
 */
function buildAuth() {
  const env = getServerEnv();
  const db = getDb();

  // A missing secret must never crash `next build` (which runs with NODE_ENV=production but
  // no runtime traffic) or local dev — it falls back to a fixed, clearly-labeled insecure
  // value and shouts loudly at request-serving time in production instead. See
  // docs/PRODUCTION.md item C: BETTER_AUTH_SECRET is a REQUIRED owner action before real
  // traffic, this fallback exists purely so the codebase is buildable/testable without it.
  const secret = env.BETTER_AUTH_SECRET ?? "dev-only-insecure-secret-do-not-use-in-production-00000000";
  if (!env.BETTER_AUTH_SECRET && process.env.NODE_ENV === "production") {
    console.error(
      "[auth] BETTER_AUTH_SECRET is not set — using an insecure development fallback. This is UNSAFE for real traffic; set BETTER_AUTH_SECRET before accepting real users (see docs/PRODUCTION.md).",
    );
  }

  const stripeConfigured = Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);

  return betterAuth({
    secret,
    baseURL: env.APP_BASE_URL,
    trustedOrigins: [env.APP_BASE_URL],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
      usePlural: false,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: false,
      // Reset also revokes every OTHER active session for the account — see the shared
      // `revokeOtherSessions` doc in Better Auth's core config; kept default-on here
      // deliberately (a compromised-password scenario should not leave old sessions valid).
      sendResetPassword: async ({ user, url }) => {
        const { subject, html, text } = resetPasswordEmail(url);
        await sendMail({ to: user.email, subject, html, text });
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        const { subject, html, text } = verificationEmail(url);
        await sendMail({ to: user.email, subject, html, text });
      },
      sendOnSignUp: false,
      autoSignInAfterVerification: true,
    },
    session: {
      cookieCache: { enabled: true, maxAge: 60 },
    },
    advanced: {
      // HTTP-only always; `Secure` only in production (matches the repo's existing
      // visitor-cookie convention in src/lib/explorer/history/visitor.ts) so local HTTP dev
      // still works.
      useSecureCookies: process.env.NODE_ENV === "production",
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 20,
    },
    plugins: stripeConfigured
      ? [
          stripe({
            stripeClient: new Stripe(env.STRIPE_SECRET_KEY!, { apiVersion: "2026-08-27.basil" as never }),
            stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET!,
            createCustomerOnSignUp: true,
            subscription: {
              enabled: true,
              plans: [
                ...(env.STRIPE_PRICE_BASIC ? [{ name: PLANS.basic.id, priceId: env.STRIPE_PRICE_BASIC }] : []),
                ...(env.STRIPE_PRICE_PLUS ? [{ name: PLANS.plus.id, priceId: env.STRIPE_PRICE_PLUS }] : []),
              ],
            },
          }),
        ]
      : [],
  });
}

let cachedAuth: ReturnType<typeof buildAuth> | undefined;

/** Lazily built, memoized singleton — mirrors src/db/index.ts's getDb() caching pattern. */
export function getAuth() {
  if (!cachedAuth) {
    cachedAuth = buildAuth();
  }
  return cachedAuth;
}
