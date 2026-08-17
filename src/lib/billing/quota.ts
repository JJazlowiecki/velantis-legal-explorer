import "server-only";

import { sql } from "drizzle-orm";
import type { getDb } from "@/db";

export interface UsagePeriod {
  limit: number;
  used: number;
  remaining: number;
  periodStart: Date;
  periodEnd: Date;
}

/** UTC calendar-month boundaries — deliberately UTC (not a business timezone) to keep the boundary deterministic and testable regardless of server/deploy timezone. */
export function currentUtcPeriod(now: Date = new Date()): { periodStart: Date; periodEnd: Date } {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { periodStart, periodEnd };
}

type Db = ReturnType<typeof getDb>;

/**
 * Atomically reserves ONE quota unit for `userId`'s current UTC calendar-month period, iff
 * `used < limit`. Race-safe by construction: this is a SINGLE SQL statement (a conditional
 * upsert), not a read-then-write from application code — Postgres serializes concurrent
 * writers on the row's unique index (`user_id, period_start`), so two simultaneous requests
 * can never both observe "one slot left" and both succeed. When the row doesn't exist yet,
 * the INSERT branch fires (used=1); when it exists and still has room, the DO UPDATE branch
 * fires; when it exists and is already at/over `limit`, the `WHERE` guard makes the conflict
 * resolution a no-op and ZERO rows are returned — that is the reservation being rejected.
 *
 * `limit` is the CALLER's freshly-resolved entitlement limit (see billing/entitlement.ts),
 * never stored on the row itself — a mid-period plan upgrade takes effect on the very next
 * request, not frozen at the period's first reservation.
 */
export async function reserveQuotaUnit(db: Db, userId: string, limit: number, now: Date = new Date()): Promise<{ reserved: boolean; used: number }> {
  const { periodStart, periodEnd } = currentUtcPeriod(now);

  const rows = await db.execute<{ used: number }>(sql`
    INSERT INTO explorer_usage_periods (user_id, period_start, period_end, used)
    VALUES (${userId}, ${periodStart.toISOString()}, ${periodEnd.toISOString()}, 1)
    ON CONFLICT (user_id, period_start)
    DO UPDATE SET used = explorer_usage_periods.used + 1, updated_at = now()
    WHERE explorer_usage_periods.used < ${limit}
    RETURNING used
  `);

  if (rows.length === 0) {
    return { reserved: false, used: limit };
  }
  return { reserved: true, used: Number(rows[0].used) };
}

/** Releases a previously reserved unit — used ONLY when an infrastructure/internal failure means no usable Explorer result was returned. Never releases below zero. */
export async function releaseQuotaUnit(db: Db, userId: string, now: Date = new Date()): Promise<void> {
  const { periodStart } = currentUtcPeriod(now);
  await db.execute(sql`
    UPDATE explorer_usage_periods
    SET used = used - 1, updated_at = now()
    WHERE user_id = ${userId} AND period_start = ${periodStart.toISOString()} AND used > 0
  `);
}

/** Read-only usage snapshot for the authenticated UI (Account page) — never mutates. */
export async function getUsagePeriod(db: Db, userId: string, limit: number, now: Date = new Date()): Promise<UsagePeriod> {
  const { periodStart, periodEnd } = currentUtcPeriod(now);
  const rows = await db.execute<{ used: number }>(sql`
    SELECT used FROM explorer_usage_periods WHERE user_id = ${userId} AND period_start = ${periodStart.toISOString()}
  `);
  const used = rows.length > 0 ? Number(rows[0].used) : 0;
  return { limit, used, remaining: Math.max(0, limit - used), periodStart, periodEnd };
}
