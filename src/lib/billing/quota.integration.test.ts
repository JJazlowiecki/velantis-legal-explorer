import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { explorerUsagePeriods, user } from "../../db/schema";
import { createTestDatabase } from "../test-support/test-db";
import { currentUtcPeriod, getUsagePeriod, releaseQuotaUnit, reserveQuotaUnit } from "./quota";

const testDatabase = createTestDatabase();
const describeDatabase = testDatabase ? describe : describe.skip;
const client = testDatabase?.client;
const db = testDatabase?.db;

const USER_ID = "quota-test-user";
const OTHER_USER_ID = "quota-test-user-2";

afterAll(async () => {
  await client?.end({ timeout: 1 });
});

describeDatabase("quota reservation (race-safe money boundary)", () => {
  beforeEach(async () => {
    if (!db) return;
    await db.insert(user).values([
      { id: USER_ID, name: "Quota Test", email: "quota-test@test.local", emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
      { id: OTHER_USER_ID, name: "Quota Test 2", email: "quota-test-2@test.local", emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
    ]).onConflictDoNothing();
    await db.delete(explorerUsagePeriods).where(eq(explorerUsagePeriods.userId, USER_ID));
    await db.delete(explorerUsagePeriods).where(eq(explorerUsagePeriods.userId, OTHER_USER_ID));
  });

  it("reserves units up to the exact limit, then rejects — for FREE (5)", async () => {
    if (!db) throw new Error("unreachable");
    const limit = 5;
    for (let i = 1; i <= limit; i += 1) {
      const result = await reserveQuotaUnit(db, USER_ID, limit);
      expect(result.reserved).toBe(true);
      expect(result.used).toBe(i);
    }
    const rejected = await reserveQuotaUnit(db, USER_ID, limit);
    expect(rejected.reserved).toBe(false);
  });

  it("reserves units up to the exact limit, then rejects — for BASIC (40)", async () => {
    if (!db) throw new Error("unreachable");
    const limit = 40;
    for (let i = 1; i <= limit; i += 1) {
      const result = await reserveQuotaUnit(db, USER_ID, limit);
      expect(result.reserved).toBe(true);
    }
    const rejected = await reserveQuotaUnit(db, USER_ID, limit);
    expect(rejected.reserved).toBe(false);
    const usage = await getUsagePeriod(db, USER_ID, limit);
    expect(usage.used).toBe(40);
    expect(usage.remaining).toBe(0);
  });

  it("reserves units up to the exact limit, then rejects — for PLUS (120)", async () => {
    if (!db) throw new Error("unreachable");
    const limit = 120;
    for (let i = 1; i <= limit; i += 1) {
      const result = await reserveQuotaUnit(db, USER_ID, limit);
      expect(result.reserved).toBe(true);
    }
    const rejected = await reserveQuotaUnit(db, USER_ID, limit);
    expect(rejected.reserved).toBe(false);
  });

  it("the final available request succeeds and the very next request is rejected", async () => {
    if (!db) throw new Error("unreachable");
    const limit = 3;
    await reserveQuotaUnit(db, USER_ID, limit);
    await reserveQuotaUnit(db, USER_ID, limit);
    const final = await reserveQuotaUnit(db, USER_ID, limit);
    expect(final.reserved).toBe(true);
    expect(final.used).toBe(3);

    const next = await reserveQuotaUnit(db, USER_ID, limit);
    expect(next.reserved).toBe(false);
  });

  it("release restores exactly one unit — a released unit can be re-reserved", async () => {
    if (!db) throw new Error("unreachable");
    const limit = 1;
    const first = await reserveQuotaUnit(db, USER_ID, limit);
    expect(first.reserved).toBe(true);

    const blocked = await reserveQuotaUnit(db, USER_ID, limit);
    expect(blocked.reserved).toBe(false);

    await releaseQuotaUnit(db, USER_ID);
    const usageAfterRelease = await getUsagePeriod(db, USER_ID, limit);
    expect(usageAfterRelease.used).toBe(0);

    const afterRelease = await reserveQuotaUnit(db, USER_ID, limit);
    expect(afterRelease.reserved).toBe(true);
  });

  it("release never goes below zero", async () => {
    if (!db) throw new Error("unreachable");
    await releaseQuotaUnit(db, USER_ID);
    await releaseQuotaUnit(db, USER_ID);
    const usage = await getUsagePeriod(db, USER_ID, 5);
    expect(usage.used).toBe(0);
  });

  it("concurrent reservations cannot overrun the limit — exactly `limit` of N simultaneous requests succeed", async () => {
    if (!db) throw new Error("unreachable");
    const limit = 5;
    const concurrentAttempts = 20;

    const results = await Promise.all(Array.from({ length: concurrentAttempts }, () => reserveQuotaUnit(db, USER_ID, limit)));
    const succeeded = results.filter((r) => r.reserved).length;
    const rejected = results.filter((r) => !r.reserved).length;

    expect(succeeded).toBe(limit);
    expect(rejected).toBe(concurrentAttempts - limit);

    const usage = await getUsagePeriod(db, USER_ID, limit);
    expect(usage.used).toBe(limit);
  });

  it("different users never contend with each other", async () => {
    if (!db) throw new Error("unreachable");
    const limit = 1;
    const userA = await reserveQuotaUnit(db, USER_ID, limit);
    const userB = await reserveQuotaUnit(db, OTHER_USER_ID, limit);
    expect(userA.reserved).toBe(true);
    expect(userB.reserved).toBe(true);
  });

  it("currentUtcPeriod computes the correct UTC calendar-month boundary", () => {
    const { periodStart, periodEnd } = currentUtcPeriod(new Date(Date.UTC(2026, 1, 15, 12, 30)));
    expect(periodStart.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(periodEnd.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("a mid-period limit increase (plan upgrade) takes effect on the very next reservation, not frozen at first use", async () => {
    if (!db) throw new Error("unreachable");
    await reserveQuotaUnit(db, USER_ID, 1);
    const blockedAtOldLimit = await reserveQuotaUnit(db, USER_ID, 1);
    expect(blockedAtOldLimit.reserved).toBe(false);

    // Simulate an upgrade mid-period: caller now passes a higher limit.
    const afterUpgrade = await reserveQuotaUnit(db, USER_ID, 5);
    expect(afterUpgrade.reserved).toBe(true);
    expect(afterUpgrade.used).toBe(2);
  });

  it("a brand-new period (a different, future month) starts with zero usage regardless of the current period's state", async () => {
    if (!db) throw new Error("unreachable");
    await reserveQuotaUnit(db, USER_ID, 1);
    const nextMonth = new Date();
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const usageNextMonth = await getUsagePeriod(db, USER_ID, 5, nextMonth);
    expect(usageNextMonth.used).toBe(0);
    expect(usageNextMonth.remaining).toBe(5);
  });
});
