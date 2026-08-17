import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { subscription } from "@/db/schema";
import type { getDb } from "@/db";
import { PLANS, type PlanId, isBillingConfigured } from "@/lib/billing/plans";

type Db = ReturnType<typeof getDb>;

export interface Entitlement {
  planId: PlanId;
  monthlyQueryLimit: number;
  /** Present only for a real paid subscription row — never for FREE. */
  subscriptionStatus: string | null;
  cancelAtPeriodEnd: boolean;
  periodEnd: Date | null;
}

const GRANTING_STATUSES = new Set(["active", "trialing"]);

/**
 * The SOLE source of truth for what a user is entitled to. Reads the `@better-auth/stripe`
 * plugin's own `subscription` table directly (never a second parallel representation) —
 * `referenceId` is the user id, `plan` is the plan name the plugin was configured with
 * (PLANS.basic.id / PLANS.plus.id). Conservative by construction: only `status IN
 * ('active','trialing')` grants paid service; canceled/incomplete/past_due/paused/unpaid/
 * unknown all fall through to FREE. If Stripe isn't configured at all, always FREE — there
 * is no other way to have a paid entitlement in that state.
 */
export async function resolveEntitlement(db: Db, userId: string): Promise<Entitlement> {
  if (!isBillingConfigured()) {
    return { planId: "free", monthlyQueryLimit: PLANS.free.monthlyQueryLimit, subscriptionStatus: null, cancelAtPeriodEnd: false, periodEnd: null };
  }

  const rows = await db
    .select()
    .from(subscription)
    .where(and(eq(subscription.referenceId, userId), inArray(subscription.plan, [PLANS.basic.id, PLANS.plus.id])))
    .orderBy(desc(subscription.periodEnd));

  const active = rows.find((row) => GRANTING_STATUSES.has(row.status));
  if (!active) {
    return { planId: "free", monthlyQueryLimit: PLANS.free.monthlyQueryLimit, subscriptionStatus: rows[0]?.status ?? null, cancelAtPeriodEnd: false, periodEnd: null };
  }

  const planId: PlanId = active.plan === PLANS.plus.id ? "plus" : "basic";
  return {
    planId,
    monthlyQueryLimit: PLANS[planId].monthlyQueryLimit,
    subscriptionStatus: active.status,
    cancelAtPeriodEnd: active.cancelAtPeriodEnd ?? false,
    periodEnd: active.periodEnd ?? null,
  };
}
