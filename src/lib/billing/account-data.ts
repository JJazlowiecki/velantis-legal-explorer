import "server-only";

import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { resolveEntitlement } from "@/lib/billing/entitlement";
import { isBillingConfigured } from "@/lib/billing/plans";
import { getUsagePeriod } from "@/lib/billing/quota";

/** Everything the Account/Plan pages need — one real, server-fetched snapshot, no demo data. */
export async function loadAccountBillingSnapshot() {
  const user = await requireUser();
  const db = getDb();
  const entitlement = await resolveEntitlement(db, user.id);
  const usage = await getUsagePeriod(db, user.id, entitlement.monthlyQueryLimit);

  return {
    email: user.email,
    emailVerified: user.emailVerified,
    entitlement,
    usage,
    billingConfigured: isBillingConfigured(),
  };
}

export type AccountBillingSnapshot = Awaited<ReturnType<typeof loadAccountBillingSnapshot>>;
