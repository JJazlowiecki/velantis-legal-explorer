"use server";

import { headers } from "next/headers";

import { getAuth } from "@/lib/auth/auth";
import { requireUser } from "@/lib/auth/session";
import { type PlanId, isBillingConfigured } from "@/lib/billing/plans";
import { getServerEnv } from "@/lib/env/server";

export type CheckoutActionResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Creates a real Stripe-hosted Checkout Session for BASIC/PLUS via the `@better-auth/stripe`
 * plugin's server API (never a client-side Stripe call — Stripe stays server-only end to
 * end). The browser NEVER receives anything but the resulting Checkout URL; entitlement
 * itself is only ever granted later, server-side, by the webhook — this action grants
 * nothing on its own.
 */
export async function createCheckoutSession(planId: Exclude<PlanId, "free">): Promise<CheckoutActionResult> {
  if (!isBillingConfigured()) {
    return { ok: false, error: "Płatności nie są jeszcze skonfigurowane w tym środowisku." };
  }
  const user = await requireUser();
  const env = getServerEnv();
  const auth = getAuth();

  try {
    const result = await auth.api.upgradeSubscription({
      headers: await headers(),
      body: {
        plan: planId,
        referenceId: user.id,
        successUrl: `${env.APP_BASE_URL}/explorer/plan?checkout=success`,
        cancelUrl: `${env.APP_BASE_URL}/explorer/plan?checkout=cancelled`,
        disableRedirect: true,
      },
    });
    if ("url" in result && result.url) {
      return { ok: true, url: result.url };
    }
    return { ok: false, error: "Nie udało się utworzyć sesji płatności." };
  } catch (error) {
    console.error("[billing] checkout session creation failed:", error instanceof Error ? error.message : "unknown error");
    return { ok: false, error: "Nie udało się utworzyć sesji płatności." };
  }
}

/** Opens the real Stripe Customer Portal for the authenticated user's own subscription — manage/cancel/update payment method. */
export async function createBillingPortalSession(): Promise<CheckoutActionResult> {
  if (!isBillingConfigured()) {
    return { ok: false, error: "Zarządzanie płatnościami nie jest jeszcze skonfigurowane w tym środowisku." };
  }
  const user = await requireUser();
  const env = getServerEnv();
  const auth = getAuth();

  try {
    const result = await auth.api.createBillingPortal({
      headers: await headers(),
      body: {
        referenceId: user.id,
        returnUrl: `${env.APP_BASE_URL}/explorer/account`,
        disableRedirect: true,
      },
    });
    if ("url" in result && result.url) {
      return { ok: true, url: result.url };
    }
    return { ok: false, error: "Nie udało się otworzyć panelu zarządzania płatnościami." };
  } catch (error) {
    console.error("[billing] billing portal creation failed:", error instanceof Error ? error.message : "unknown error");
    return { ok: false, error: "Nie udało się otworzyć panelu zarządzania płatnościami." };
  }
}
