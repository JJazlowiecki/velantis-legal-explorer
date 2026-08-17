import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema";
import { explorerHistoryEntries } from "../../../db/schema";
import {
  explorerHistoryCorpusProvenanceSchema,
  explorerHistoryCorpusVersionIdsSchema,
  explorerHistorySnapshotSchema,
  explorerHistoryStatusSchema,
  type ExplorerHistoryCorpusProvenance,
  type ExplorerHistorySnapshot,
  type ExplorerHistoryStatus,
} from "./snapshot";

export class HistoryServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoryServiceError";
  }
}

export interface HistoryEntryRecord {
  id: string;
  query: string;
  status: ExplorerHistoryStatus;
  snapshot: ExplorerHistorySnapshot;
  corpusVersionIds: string[];
  corpusProvenance: ExplorerHistoryCorpusProvenance;
  createdAt: Date;
}

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Rehydrates and validates one raw DB row into a trustworthy `HistoryEntryRecord`, or returns
 * null if the persisted JSON no longer matches the expected snapshot shape. A JSONB column is
 * not intrinsically safe just because this service wrote it — treat it like any other
 * untrusted input on the way back out.
 */
function parseRow(row: typeof explorerHistoryEntries.$inferSelect): HistoryEntryRecord | null {
  const status = explorerHistoryStatusSchema.safeParse(row.status);
  const snapshot = explorerHistorySnapshotSchema.safeParse(row.resultSnapshot);
  const corpusVersionIds = explorerHistoryCorpusVersionIdsSchema.safeParse(row.corpusVersionIds);
  const corpusProvenance = explorerHistoryCorpusProvenanceSchema.safeParse({
    corpusRunId: row.corpusRunId,
    rulesetVersion: row.rulesetVersion,
    effectiveAsOf: row.effectiveAsOf,
  });

  if (!status.success || !snapshot.success || !corpusVersionIds.success || !corpusProvenance.success) {
    console.error(`[explorer-history] malformed persisted entry ${row.id}: failed snapshot validation on read`);
    return null;
  }

  return {
    id: row.id,
    query: row.query,
    status: status.data,
    snapshot: snapshot.data,
    corpusVersionIds: corpusVersionIds.data,
    corpusProvenance: corpusProvenance.data,
    createdAt: row.createdAt,
  };
}

export interface CreateHistoryEntryInput {
  db: Db;
  visitorId: string;
  /** Real ownership (see src/lib/auth/session.ts) — required since Production & Monetization v1: /explorer is now auth-only, so every new write is always attributed to a real authenticated user. */
  userId: string;
  query: string;
  status: ExplorerHistoryStatus;
  snapshot: ExplorerHistorySnapshot;
  corpusVersionIds: string[];
  /** Defaults to all-null (historical test mode) when omitted. */
  corpusProvenance?: ExplorerHistoryCorpusProvenance;
}

const NULL_CORPUS_PROVENANCE: ExplorerHistoryCorpusProvenance = {
  corpusRunId: null,
  rulesetVersion: null,
  effectiveAsOf: null,
};

/** Validates the snapshot/status/corpusVersionIds/corpusProvenance BEFORE writing — never persist data that wouldn't survive being read back. */
export async function createHistoryEntry(input: CreateHistoryEntryInput): Promise<{ id: string }> {
  const status = explorerHistoryStatusSchema.parse(input.status);
  const snapshot = explorerHistorySnapshotSchema.parse(input.snapshot);
  const corpusVersionIds = explorerHistoryCorpusVersionIdsSchema.parse(input.corpusVersionIds);
  const corpusProvenance = explorerHistoryCorpusProvenanceSchema.parse(input.corpusProvenance ?? NULL_CORPUS_PROVENANCE);

  if (!input.visitorId) {
    throw new HistoryServiceError("createHistoryEntry requires a visitorId");
  }
  if (!input.userId) {
    throw new HistoryServiceError("createHistoryEntry requires a userId");
  }

  const [row] = await input.db
    .insert(explorerHistoryEntries)
    .values({
      visitorId: input.visitorId,
      userId: input.userId,
      query: input.query,
      status,
      resultSnapshot: snapshot,
      corpusVersionIds,
      corpusRunId: corpusProvenance.corpusRunId,
      rulesetVersion: corpusProvenance.rulesetVersion,
      effectiveAsOf: corpusProvenance.effectiveAsOf,
    })
    .returning({ id: explorerHistoryEntries.id });

  return { id: row.id };
}

const DEFAULT_LIST_LIMIT = 100;

export interface ListHistoryEntriesInput {
  db: Db;
  userId: string;
  limit?: number;
}

/** Newest first, bounded by a simple limit (default/hard cap 100) — no unbounded history load, no elaborate pagination. Owner-scoped: rows with a different (or null, i.e. legacy pre-auth) userId are never returned. */
export async function listHistoryEntries(input: ListHistoryEntriesInput): Promise<HistoryEntryRecord[]> {
  if (!input.userId) {
    return [];
  }

  const limit = Math.min(input.limit ?? DEFAULT_LIST_LIMIT, DEFAULT_LIST_LIMIT);

  const rows = await input.db
    .select()
    .from(explorerHistoryEntries)
    .where(eq(explorerHistoryEntries.userId, input.userId))
    .orderBy(desc(explorerHistoryEntries.createdAt))
    .limit(limit);

  return rows.map(parseRow).filter((entry): entry is HistoryEntryRecord => entry !== null);
}

export interface GetHistoryEntryInput {
  db: Db;
  userId: string;
  id: string;
}

/** Returns null both when the entry doesn't exist AND when it belongs to a different owner — the caller can't distinguish the two, by design. */
export async function getHistoryEntry(input: GetHistoryEntryInput): Promise<HistoryEntryRecord | null> {
  if (!input.userId) {
    return null;
  }

  const [row] = await input.db
    .select()
    .from(explorerHistoryEntries)
    .where(and(eq(explorerHistoryEntries.id, input.id), eq(explorerHistoryEntries.userId, input.userId)))
    .limit(1);

  return row ? parseRow(row) : null;
}

export interface DeleteHistoryEntryInput {
  db: Db;
  userId: string;
  id: string;
}

/** Scoped delete — a non-existent id or an id owned by another user is silently a no-op, never an error. */
export async function deleteHistoryEntry(input: DeleteHistoryEntryInput): Promise<void> {
  if (!input.userId) {
    return;
  }

  await input.db
    .delete(explorerHistoryEntries)
    .where(and(eq(explorerHistoryEntries.id, input.id), eq(explorerHistoryEntries.userId, input.userId)));
}

export type ClearHistoryScope = "all" | "last_7_days" | "last_30_days" | "custom";

export interface ClearHistoryInput {
  db: Db;
  userId: string;
  scope: ClearHistoryScope;
  /** Required (and only used) when scope === "custom". */
  from?: Date;
  to?: Date;
}

/** Always owner-scoped. "custom" requires both `from` and `to`; other scopes ignore them. */
export async function clearHistory(input: ClearHistoryInput): Promise<void> {
  if (!input.userId) {
    return;
  }

  const visitorCondition = eq(explorerHistoryEntries.userId, input.userId);

  if (input.scope === "all") {
    await input.db.delete(explorerHistoryEntries).where(visitorCondition);
    return;
  }

  if (input.scope === "last_7_days" || input.scope === "last_30_days") {
    const days = input.scope === "last_7_days" ? 7 : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    await input.db.delete(explorerHistoryEntries).where(and(visitorCondition, gte(explorerHistoryEntries.createdAt, since)));
    return;
  }

  // scope === "custom"
  if (!input.from || !input.to) {
    throw new HistoryServiceError("clearHistory with scope \"custom\" requires both from and to dates");
  }

  await input.db
    .delete(explorerHistoryEntries)
    .where(and(visitorCondition, gte(explorerHistoryEntries.createdAt, input.from), lt(explorerHistoryEntries.createdAt, input.to)));
}

/**
 * Serializes automatic-cleanup runs for one visitor behind a transaction-scoped Postgres
 * advisory lock, namespaced separately from Saved's lock (see
 * src/lib/explorer/saved/service.ts) so the two features never contend with each other. This
 * is what keeps two near-simultaneous searches from the same visitor from both reading "304
 * rows" and both deciding "nothing to trim" — the second write always sees the first's
 * cleanup effects before running its own.
 */
async function lockVisitorForHistoryCleanup(tx: Db, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId} || ':explorer-history'))`);
}

export interface CleanupHistoryInput {
  db: Db;
  userId: string;
  /** Entries with created_at strictly older than (now - retentionDays) are deleted. */
  retentionDays: number;
  /** After retention cleanup, only the newest maxEntries rows for this owner are kept. */
  maxEntries: number;
}

/**
 * Server env validation already requires positive integers for the retention config, but the
 * service boundary must not trust that a caller went through env parsing — e.g. a
 * misconfigured/refactored call site passing 0 must not be able to wipe all History. Checked
 * BEFORE the lock/transaction so an invalid call executes zero DELETEs, not a partial one.
 * "0" is deliberately rejected rather than treated as "no limit" — this function has exactly
 * one job (rolling cleanup with positive limits); wiping all History intentionally is
 * `clearHistory({ scope: "all" })`'s job, not this one's.
 */
function assertValidCleanupLimits(retentionDays: number, maxEntries: number): void {
  for (const [name, value] of [
    ["retentionDays", retentionDays],
    ["maxEntries", maxEntries],
  ] as const) {
    if (!Number.isFinite(value)) {
      throw new HistoryServiceError(`cleanupHistoryForVisitor requires a finite ${name}, got ${value}`);
    }
    if (!Number.isInteger(value)) {
      throw new HistoryServiceError(`cleanupHistoryForVisitor requires an integer ${name}, got ${value}`);
    }
    if (value <= 0) {
      throw new HistoryServiceError(`cleanupHistoryForVisitor requires a positive ${name}, got ${value}`);
    }
  }
}

/**
 * Opportunistic rolling-history cleanup: age-based retention first, then an entry-count cap
 * (oldest deleted first). Both limits are visitor-scoped — this can never touch another
 * visitor's rows, and it only ever deletes from explorer_history_entries, never
 * explorer_saved_items/explorer_saved_folders (Saved is a fully independent copy and must
 * survive its source History entry being cleaned up). Callers are expected to treat a
 * rejected promise here as non-fatal to whatever triggered the call.
 */
export async function cleanupHistoryForVisitor(input: CleanupHistoryInput): Promise<void> {
  if (!input.userId) {
    return;
  }

  assertValidCleanupLimits(input.retentionDays, input.maxEntries);

  await input.db.transaction(async (tx) => {
    await lockVisitorForHistoryCleanup(tx, input.userId);

    const retentionCutoff = new Date(Date.now() - input.retentionDays * 24 * 60 * 60 * 1000);
    await tx
      .delete(explorerHistoryEntries)
      .where(and(eq(explorerHistoryEntries.userId, input.userId), lt(explorerHistoryEntries.createdAt, retentionCutoff)));

    // Keep only the newest maxEntries rows for this owner; delete the rest. Written as a
    // single statement (rather than select-ids-then-delete) so it stays correct under the
    // advisory lock without a second round trip.
    await tx.execute(sql`
      delete from ${explorerHistoryEntries}
      where id in (
        select id from ${explorerHistoryEntries}
        where user_id = ${input.userId}
        order by created_at desc, id desc
        offset ${input.maxEntries}
      )
    `);
  });
}

/**
 * Same as cleanupHistoryForVisitor, but never rejects — errors are logged (message only, no
 * query content) and swallowed. This is the entry point actual callers (e.g.
 * src/app/explorer/actions.ts) should use: recording a new history entry, and the legal
 * answer it's attached to, must never fail merely because opportunistic cleanup hit a
 * problem.
 */
export async function safeCleanupHistoryForVisitor(input: CleanupHistoryInput): Promise<void> {
  try {
    await cleanupHistoryForVisitor(input);
  } catch (error) {
    console.error("[explorer-history] cleanup failed:", error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
  }
}
