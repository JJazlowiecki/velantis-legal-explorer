import "server-only";

import { getServerEnv } from "@/lib/env/server";

export type PlanId = "free" | "basic" | "plus";

export interface PlanDefinition {
	id: PlanId;
	name: string;
	/** Display-only price string — never used for real billing amounts (Stripe Price objects are authoritative for that). */
	displayPrice: string;
	monthlyQueryLimit: number;
	/** Env var name holding this plan's Stripe Price ID — null for FREE (no Stripe object). */
	priceEnvVar: "STRIPE_PRICE_BASIC" | "STRIPE_PRICE_PLUS" | null;
}

/** Centralized, strongly-typed plan catalogue. Real Stripe Price IDs are NEVER hard-coded here — see resolvePriceId. */
export const PLANS: Record<PlanId, PlanDefinition> = {
	free: { id: "free", name: "FREE", displayPrice: "0 PLN", monthlyQueryLimit: 5, priceEnvVar: null },
	basic: { id: "basic", name: "BASIC", displayPrice: "14.99 PLN / miesiąc", monthlyQueryLimit: 40, priceEnvVar: "STRIPE_PRICE_BASIC" },
	plus: { id: "plus", name: "PLUS", displayPrice: "29.99 PLN / miesiąc", monthlyQueryLimit: 120, priceEnvVar: "STRIPE_PRICE_PLUS" },
};

export const PLAN_ORDER: PlanId[] = ["free", "basic", "plus"];

/** Resolves a plan's real Stripe Price ID from server env — never hard-coded, never null for a configured paid plan. */
export function resolvePriceId(planId: PlanId): string | null {
	const plan = PLANS[planId];
	if (!plan.priceEnvVar) return null;
	const env = getServerEnv();
	return env[plan.priceEnvVar] ?? null;
}

/** Maps a Stripe Price ID back to a plan — used when reading subscription state (never trusts a client-claimed plan). */
export function planIdForPriceId(priceId: string | null | undefined): PlanId | null {
	if (!priceId) return null;
	const env = getServerEnv();
	if (env.STRIPE_PRICE_BASIC && priceId === env.STRIPE_PRICE_BASIC) return "basic";
	if (env.STRIPE_PRICE_PLUS && priceId === env.STRIPE_PRICE_PLUS) return "plus";
	return null;
}

export function isBillingConfigured(): boolean {
	const env = getServerEnv();
	return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRICE_BASIC && env.STRIPE_PRICE_PLUS);
}
