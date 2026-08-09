import { and, desc, eq, gte, lt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema";
import { explorerHistoryEntries } from "../../../db/schema";
import {
  explorerHistoryCorpusVersionIdsSchema,
  explorerHistorySnapshotSchema,
  explorerHistoryStatusSchema,
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

  if (!status.success || !snapshot.success || !corpusVersionIds.success) {
    console.error(`[explorer-history] malformed persisted entry ${row.id}: failed snapshot validation on read`);
    return null;
  }

  return {
    id: row.id,
    query: row.query,
    status: status.data,
    snapshot: snapshot.data,
    corpusVersionIds: corpusVersionIds.data,
    createdAt: row.createdAt,
  };
}

export interface CreateHistoryEntryInput {
  db: Db;
  visitorId: string;
  query: string;
  status: ExplorerHistoryStatus;
  snapshot: ExplorerHistorySnapshot;
  corpusVersionIds: string[];
}

/** Validates the snapshot/status/corpusVersionIds BEFORE writing — never persist data that wouldn't survive being read back. */
export async function createHistoryEntry(input: CreateHistoryEntryInput): Promise<{ id: string }> {
  const status = explorerHistoryStatusSchema.parse(input.status);
  const snapshot = explorerHistorySnapshotSchema.parse(input.snapshot);
  const corpusVersionIds = explorerHistoryCorpusVersionIdsSchema.parse(input.corpusVersionIds);

  if (!input.visitorId) {
    throw new HistoryServiceError("createHistoryEntry requires a visitorId");
  }

  const [row] = await input.db
    .insert(explorerHistoryEntries)
    .values({
      visitorId: input.visitorId,
      query: input.query,
      status,
      resultSnapshot: snapshot,
      corpusVersionIds,
    })
    .returning({ id: explorerHistoryEntries.id });

  return { id: row.id };
}

const DEFAULT_LIST_LIMIT = 100;

export interface ListHistoryEntriesInput {
  db: Db;
  visitorId: string;
  limit?: number;
}

/** Newest first, bounded by a simple limit (default/hard cap 100) — no unbounded history load, no elaborate pagination. */
export async function listHistoryEntries(input: ListHistoryEntriesInput): Promise<HistoryEntryRecord[]> {
  if (!input.visitorId) {
    return [];
  }

  const limit = Math.min(input.limit ?? DEFAULT_LIST_LIMIT, DEFAULT_LIST_LIMIT);

  const rows = await input.db
    .select()
    .from(explorerHistoryEntries)
    .where(eq(explorerHistoryEntries.visitorId, input.visitorId))
    .orderBy(desc(explorerHistoryEntries.createdAt))
    .limit(limit);

  return rows.map(parseRow).filter((entry): entry is HistoryEntryRecord => entry !== null);
}

export interface GetHistoryEntryInput {
  db: Db;
  visitorId: string;
  id: string;
}

/** Returns null both when the entry doesn't exist AND when it belongs to a different visitor — the caller can't distinguish the two, by design. */
export async function getHistoryEntry(input: GetHistoryEntryInput): Promise<HistoryEntryRecord | null> {
  if (!input.visitorId) {
    return null;
  }

  const [row] = await input.db
    .select()
    .from(explorerHistoryEntries)
    .where(and(eq(explorerHistoryEntries.id, input.id), eq(explorerHistoryEntries.visitorId, input.visitorId)))
    .limit(1);

  return row ? parseRow(row) : null;
}

export interface DeleteHistoryEntryInput {
  db: Db;
  visitorId: string;
  id: string;
}

/** Scoped delete — a non-existent id or an id owned by another visitor is silently a no-op, never an error. */
export async function deleteHistoryEntry(input: DeleteHistoryEntryInput): Promise<void> {
  if (!input.visitorId) {
    return;
  }

  await input.db
    .delete(explorerHistoryEntries)
    .where(and(eq(explorerHistoryEntries.id, input.id), eq(explorerHistoryEntries.visitorId, input.visitorId)));
}

export type ClearHistoryScope = "all" | "last_7_days" | "last_30_days" | "custom";

export interface ClearHistoryInput {
  db: Db;
  visitorId: string;
  scope: ClearHistoryScope;
  /** Required (and only used) when scope === "custom". */
  from?: Date;
  to?: Date;
}

/** Always visitor-scoped. "custom" requires both `from` and `to`; other scopes ignore them. */
export async function clearHistory(input: ClearHistoryInput): Promise<void> {
  if (!input.visitorId) {
    return;
  }

  const visitorCondition = eq(explorerHistoryEntries.visitorId, input.visitorId);

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
