import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { subscription, user } from "../../db/schema";
import { createTestDatabase } from "../test-support/test-db";
import { resolveEntitlement } from "./entitlement";
import { PLANS } from "./plans";

const testDatabase = createTestDatabase();
const describeDatabase = testDatabase ? describe : describe.skip;
const client = testDatabase?.client;
const db = testDatabase?.db;

const USER_ID = "entitlement-test-user";

const billingWasConfigured =
  Boolean(process.env.STRIPE_SECRET_KEY) &&
  Boolean(process.env.STRIPE_WEBHOOK_SECRET) &&
  Boolean(process.env.STRIPE_PRICE_BASIC) &&
  Boolean(process.env.STRIPE_PRICE_PLUS);
// This suite specifically exercises the "billing IS configured" branch of resolveEntitlement,
// which requires real STRIPE_PRICE_* env values to exist (see isBillingConfigured). Local dev
// without Stripe secrets configured is expected and documented — skip rather than fail.
const describeBilling = billingWasConfigured ? describeDatabase : describe.skip;

afterAll(async () => {
  await client?.end({ timeout: 1 });
});

describeBilling("resolveEntitlement (billing configured)", () => {
  beforeEach(async () => {
    if (!db) return;
    await db
      .insert(user)
      .values({ id: USER_ID, name: "Entitlement Test", email: "entitlement-test@test.local", emailVerified: false, createdAt: new Date(), updatedAt: new Date() })
      .onConflictDoNothing();
    await db.delete(subscription).where(eq(subscription.referenceId, USER_ID));
  });

  it("no subscription at all => FREE", async () => {
    if (!db) throw new Error("unreachable");
    const result = await resolveEntitlement(db, USER_ID);
    expect(result.planId).toBe("free");
    expect(result.monthlyQueryLimit).toBe(PLANS.free.monthlyQueryLimit);
  });

  it("a proven active BASIC subscription => BASIC", async () => {
    if (!db) throw new Error("unreachable");
    await db.insert(subscription).values({
      id: "sub-basic-1",
      plan: "basic",
      referenceId: USER_ID,
      status: "active",
      priceId: process.env.STRIPE_PRICE_BASIC,
      periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    const result = await resolveEntitlement(db, USER_ID);
    expect(result.planId).toBe("basic");
    expect(result.monthlyQueryLimit).toBe(PLANS.basic.monthlyQueryLimit);
  });

  it("a proven trialing PLUS subscription => PLUS", async () => {
    if (!db) throw new Error("unreachable");
    await db.insert(subscription).values({
      id: "sub-plus-1",
      plan: "plus",
      referenceId: USER_ID,
      status: "trialing",
      priceId: process.env.STRIPE_PRICE_PLUS,
    });
    const result = await resolveEntitlement(db, USER_ID);
    expect(result.planId).toBe("plus");
    expect(result.monthlyQueryLimit).toBe(PLANS.plus.monthlyQueryLimit);
  });

  it("a canceled subscription grants no paid entitlement (falls back to FREE)", async () => {
    if (!db) throw new Error("unreachable");
    await db.insert(subscription).values({
      id: "sub-canceled-1",
      plan: "basic",
      referenceId: USER_ID,
      status: "canceled",
    });
    const result = await resolveEntitlement(db, USER_ID);
    expect(result.planId).toBe("free");
  });

  it("a past_due subscription grants no paid entitlement (conservative — fails closed to FREE)", async () => {
    if (!db) throw new Error("unreachable");
    await db.insert(subscription).values({
      id: "sub-pastdue-1",
      plan: "plus",
      referenceId: USER_ID,
      status: "past_due",
    });
    const result = await resolveEntitlement(db, USER_ID);
    expect(result.planId).toBe("free");
  });

  it("an incomplete subscription grants no paid entitlement", async () => {
    if (!db) throw new Error("unreachable");
    await db.insert(subscription).values({
      id: "sub-incomplete-1",
      plan: "basic",
      referenceId: USER_ID,
      status: "incomplete",
    });
    const result = await resolveEntitlement(db, USER_ID);
    expect(result.planId).toBe("free");
  });
});

describeDatabase("resolveEntitlement (billing not configured)", () => {
  it("always resolves to FREE when Stripe isn't configured, regardless of any subscription rows", async () => {
    if (billingWasConfigured) return; // this environment has real Stripe env — the other describe block covers it
    if (!db) throw new Error("unreachable");
    const result = await resolveEntitlement(db, "any-user-id");
    expect(result.planId).toBe("free");
    expect(result.subscriptionStatus).toBeNull();
  });
});
