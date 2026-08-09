import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema";
import { explorerSavedFolders, explorerSavedItems } from "../../../db/schema";
import { FOLDER_NAME_MAX_LENGTH, FOLDER_NAME_MIN_LENGTH, MAX_FOLDERS_PER_VISITOR } from "./quota";
import {
  parseSavedSnapshot,
  safeParseSavedSnapshot,
  savedItemKindSchema,
  type SavedItemKind,
  type SavedSnapshot,
} from "./snapshot";

export class SavedServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavedServiceError";
  }
}

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Serializes ALL Saved mutations (folders and items) for one visitor behind a single
 * transaction-scoped Postgres advisory lock. This is the concurrency-safety mechanism for
 * both quota enforcement (item 16 of the milestone spec) and duplicate-name/duplicate-save
 * races: a naive "SELECT COUNT then INSERT if under limit" can exceed quota under two
 * near-simultaneous requests, but since every mutating call takes this lock first, two
 * concurrent requests for the same visitor are fully serialized — the second always sees the
 * first's effects before making its own decision. No Redis/distributed lock needed; plain
 * PostgreSQL `pg_advisory_xact_lock` (released automatically at transaction end) is enough.
 * Different visitors never contend with each other (hashtext of the visitor id + namespace).
 */
async function lockVisitorForSavedMutation(tx: Db, visitorId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${visitorId} || ':explorer-saved'))`);
}

export interface SavedFolderRecord {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SavedItemRecord {
  id: string;
  kind: SavedItemKind;
  title: string;
  query: string | null;
  folderId: string | null;
  snapshot: SavedSnapshot;
  createdAt: Date;
  updatedAt: Date;
}

function parseSavedItemRow(row: typeof explorerSavedItems.$inferSelect): SavedItemRecord | null {
  const kindResult = savedItemKindSchema.safeParse(row.kind);
  if (!kindResult.success) {
    console.error(`[explorer-saved] malformed persisted item ${row.id}: unknown kind`);
    return null;
  }

  const snapshotResult = safeParseSavedSnapshot(kindResult.data, row.snapshot);
  if (!snapshotResult.success || !snapshotResult.data) {
    console.error(`[explorer-saved] malformed persisted item ${row.id}: failed snapshot validation on read`);
    return null;
  }

  return {
    id: row.id,
    kind: kindResult.data,
    title: row.title,
    query: row.query,
    folderId: row.folderId,
    snapshot: snapshotResult.data,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type FolderNameError = "blank" | "too_long";

function validateFolderName(raw: string): { ok: true; name: string } | { ok: false; error: FolderNameError } {
  const name = raw.trim();
  if (name.length < FOLDER_NAME_MIN_LENGTH) {
    return { ok: false, error: "blank" };
  }
  if (name.length > FOLDER_NAME_MAX_LENGTH) {
    return { ok: false, error: "too_long" };
  }
  return { ok: true, name };
}

export interface ListSavedFoldersInput {
  db: Db;
  visitorId: string;
}

export async function listSavedFolders(input: ListSavedFoldersInput): Promise<SavedFolderRecord[]> {
  if (!input.visitorId) {
    return [];
  }

  const rows = await input.db
    .select()
    .from(explorerSavedFolders)
    .where(eq(explorerSavedFolders.visitorId, input.visitorId))
    .orderBy(asc(explorerSavedFolders.name));

  return rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.createdAt, updatedAt: row.updatedAt }));
}

export interface CreateSavedFolderInput {
  db: Db;
  visitorId: string;
  name: string;
}

export type CreateSavedFolderResult =
  | { status: "created"; id: string }
  | { status: "invalid_name"; reason: FolderNameError }
  | { status: "duplicate_name" }
  | { status: "limit_exceeded"; limit: number };

export async function createSavedFolder(input: CreateSavedFolderInput): Promise<CreateSavedFolderResult> {
  if (!input.visitorId) {
    throw new SavedServiceError("createSavedFolder requires a visitorId");
  }

  const validated = validateFolderName(input.name);
  if (!validated.ok) {
    return { status: "invalid_name", reason: validated.error };
  }

  return input.db.transaction(async (tx) => {
    await lockVisitorForSavedMutation(tx, input.visitorId);

    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(explorerSavedFolders)
      .where(eq(explorerSavedFolders.visitorId, input.visitorId));
    if (count >= MAX_FOLDERS_PER_VISITOR) {
      return { status: "limit_exceeded" as const, limit: MAX_FOLDERS_PER_VISITOR };
    }

    const duplicate = await tx
      .select({ id: explorerSavedFolders.id })
      .from(explorerSavedFolders)
      .where(
        and(
          eq(explorerSavedFolders.visitorId, input.visitorId),
          sql`lower(${explorerSavedFolders.name}) = lower(${validated.name})`,
        ),
      )
      .limit(1);
    if (duplicate.length > 0) {
      return { status: "duplicate_name" as const };
    }

    const [row] = await tx
      .insert(explorerSavedFolders)
      .values({ visitorId: input.visitorId, name: validated.name })
      .returning({ id: explorerSavedFolders.id });

    return { status: "created" as const, id: row.id };
  });
}

export interface RenameSavedFolderInput {
  db: Db;
  visitorId: string;
  id: string;
  name: string;
}

export type RenameSavedFolderResult =
  | { status: "renamed" }
  | { status: "not_found" }
  | { status: "invalid_name"; reason: FolderNameError }
  | { status: "duplicate_name" };

export async function renameSavedFolder(input: RenameSavedFolderInput): Promise<RenameSavedFolderResult> {
  if (!input.visitorId) {
    throw new SavedServiceError("renameSavedFolder requires a visitorId");
  }

  const validated = validateFolderName(input.name);
  if (!validated.ok) {
    return { status: "invalid_name", reason: validated.error };
  }

  return input.db.transaction(async (tx) => {
    await lockVisitorForSavedMutation(tx, input.visitorId);

    const [existing] = await tx
      .select({ id: explorerSavedFolders.id })
      .from(explorerSavedFolders)
      .where(and(eq(explorerSavedFolders.id, input.id), eq(explorerSavedFolders.visitorId, input.visitorId)))
      .limit(1);
    if (!existing) {
      return { status: "not_found" as const };
    }

    const duplicate = await tx
      .select({ id: explorerSavedFolders.id })
      .from(explorerSavedFolders)
      .where(
        and(
          eq(explorerSavedFolders.visitorId, input.visitorId),
          sql`lower(${explorerSavedFolders.name}) = lower(${validated.name})`,
          ne(explorerSavedFolders.id, input.id),
        ),
      )
      .limit(1);
    if (duplicate.length > 0) {
      return { status: "duplicate_name" as const };
    }

    await tx
      .update(explorerSavedFolders)
      .set({ name: validated.name, updatedAt: new Date() })
      .where(and(eq(explorerSavedFolders.id, input.id), eq(explorerSavedFolders.visitorId, input.visitorId)));

    return { status: "renamed" as const };
  });
}

export interface DeleteSavedFolderInput {
  db: Db;
  visitorId: string;
  id: string;
}

/**
 * Deleting a folder never deletes its items — the FK's `onDelete: "set null"` unfiles them
 * automatically (folder_id becomes null, i.e. "Bez folderu") as part of this same statement.
 * Visitor-scoped; a nonexistent or foreign folder id is a safe no-op.
 */
export async function deleteSavedFolder(input: DeleteSavedFolderInput): Promise<void> {
  if (!input.visitorId) {
    return;
  }

  await input.db
    .delete(explorerSavedFolders)
    .where(and(eq(explorerSavedFolders.id, input.id), eq(explorerSavedFolders.visitorId, input.visitorId)));
}

export interface CreateSavedItemInput {
  db: Db;
  visitorId: string;
  kind: SavedItemKind;
  title: string;
  query?: string | null;
  folderId?: string | null;
  snapshot: SavedSnapshot;
  contentKey: string;
  /** Resolved by the caller (env default today; a future plan lookup later) — see quota.ts. */
  maxItems: number;
}

export type CreateSavedItemResult =
  | { status: "created"; id: string }
  | { status: "already_saved"; id: string }
  | { status: "quota_exceeded"; limit: number }
  | { status: "folder_not_found" };

/**
 * Folders never count toward the item quota (only explorer_saved_items rows are counted).
 * Duplicate-save detection and quota enforcement both happen inside the same
 * visitor-locked transaction — see lockVisitorForSavedMutation.
 */
export async function createSavedItem(input: CreateSavedItemInput): Promise<CreateSavedItemResult> {
  if (!input.visitorId) {
    throw new SavedServiceError("createSavedItem requires a visitorId");
  }

  // Validate BEFORE persisting — never write a snapshot that wouldn't survive being read back.
  parseSavedSnapshot(input.kind, input.snapshot);

  return input.db.transaction(async (tx) => {
    await lockVisitorForSavedMutation(tx, input.visitorId);

    if (input.folderId) {
      const [folder] = await tx
        .select({ id: explorerSavedFolders.id })
        .from(explorerSavedFolders)
        .where(and(eq(explorerSavedFolders.id, input.folderId), eq(explorerSavedFolders.visitorId, input.visitorId)))
        .limit(1);
      if (!folder) {
        return { status: "folder_not_found" as const };
      }
    }

    const [existing] = await tx
      .select({ id: explorerSavedItems.id })
      .from(explorerSavedItems)
      .where(
        and(
          eq(explorerSavedItems.visitorId, input.visitorId),
          eq(explorerSavedItems.kind, input.kind),
          eq(explorerSavedItems.contentKey, input.contentKey),
        ),
      )
      .limit(1);
    if (existing) {
      return { status: "already_saved" as const, id: existing.id };
    }

    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(explorerSavedItems)
      .where(eq(explorerSavedItems.visitorId, input.visitorId));
    if (count >= input.maxItems) {
      return { status: "quota_exceeded" as const, limit: input.maxItems };
    }

    const [row] = await tx
      .insert(explorerSavedItems)
      .values({
        visitorId: input.visitorId,
        folderId: input.folderId ?? null,
        kind: input.kind,
        title: input.title,
        query: input.query ?? null,
        contentKey: input.contentKey,
        snapshot: input.snapshot,
      })
      .returning({ id: explorerSavedItems.id });

    return { status: "created" as const, id: row.id };
  });
}

const DEFAULT_SAVED_LIST_LIMIT = 200;

export interface ListSavedItemsInput {
  db: Db;
  visitorId: string;
  limit?: number;
}

/** Newest first, bounded (default/hard cap 200) — no unbounded load, no elaborate pagination. */
export async function listSavedItems(input: ListSavedItemsInput): Promise<SavedItemRecord[]> {
  if (!input.visitorId) {
    return [];
  }

  const limit = Math.min(input.limit ?? DEFAULT_SAVED_LIST_LIMIT, DEFAULT_SAVED_LIST_LIMIT);

  const rows = await input.db
    .select()
    .from(explorerSavedItems)
    .where(eq(explorerSavedItems.visitorId, input.visitorId))
    .orderBy(desc(explorerSavedItems.createdAt))
    .limit(limit);

  return rows.map(parseSavedItemRow).filter((item): item is SavedItemRecord => item !== null);
}

export interface GetSavedItemInput {
  db: Db;
  visitorId: string;
  id: string;
}

export async function getSavedItem(input: GetSavedItemInput): Promise<SavedItemRecord | null> {
  if (!input.visitorId) {
    return null;
  }

  const [row] = await input.db
    .select()
    .from(explorerSavedItems)
    .where(and(eq(explorerSavedItems.id, input.id), eq(explorerSavedItems.visitorId, input.visitorId)))
    .limit(1);

  return row ? parseSavedItemRow(row) : null;
}

export interface DeleteSavedItemInput {
  db: Db;
  visitorId: string;
  id: string;
}

/**
 * Deletes only the Saved row itself — never touches History, source provisions, legal act
 * data, or search documents (those live in entirely separate tables this function never
 * references). Visitor-scoped; a nonexistent or foreign id is a safe no-op.
 */
export async function deleteSavedItem(input: DeleteSavedItemInput): Promise<void> {
  if (!input.visitorId) {
    return;
  }

  await input.db
    .delete(explorerSavedItems)
    .where(and(eq(explorerSavedItems.id, input.id), eq(explorerSavedItems.visitorId, input.visitorId)));
}

export interface MoveSavedItemInput {
  db: Db;
  visitorId: string;
  id: string;
  folderId: string | null;
}

export type MoveSavedItemResult = { status: "moved" } | { status: "item_not_found" } | { status: "folder_not_found" };

/**
 * Moves a saved item into a folder (or to "Bez folderu" when folderId is null). Both the item
 * AND the target folder are ownership-checked against visitorId — a visitor can never move
 * their own item into another visitor's folder merely because that folder's UUID is valid.
 */
export async function moveSavedItem(input: MoveSavedItemInput): Promise<MoveSavedItemResult> {
  if (!input.visitorId) {
    return { status: "item_not_found" };
  }

  return input.db.transaction(async (tx) => {
    await lockVisitorForSavedMutation(tx, input.visitorId);

    const [item] = await tx
      .select({ id: explorerSavedItems.id })
      .from(explorerSavedItems)
      .where(and(eq(explorerSavedItems.id, input.id), eq(explorerSavedItems.visitorId, input.visitorId)))
      .limit(1);
    if (!item) {
      return { status: "item_not_found" as const };
    }

    if (input.folderId) {
      const [folder] = await tx
        .select({ id: explorerSavedFolders.id })
        .from(explorerSavedFolders)
        .where(and(eq(explorerSavedFolders.id, input.folderId), eq(explorerSavedFolders.visitorId, input.visitorId)))
        .limit(1);
      if (!folder) {
        return { status: "folder_not_found" as const };
      }
    }

    await tx
      .update(explorerSavedItems)
      .set({ folderId: input.folderId, updatedAt: new Date() })
      .where(and(eq(explorerSavedItems.id, input.id), eq(explorerSavedItems.visitorId, input.visitorId)));

    return { status: "moved" as const };
  });
}

export interface SavedUsage {
  count: number;
  max: number;
}

export interface GetSavedUsageInput {
  db: Db;
  visitorId: string;
  maxItems: number;
}

export async function getSavedUsage(input: GetSavedUsageInput): Promise<SavedUsage> {
  if (!input.visitorId) {
    return { count: 0, max: input.maxItems };
  }

  const [{ count }] = await input.db
    .select({ count: sql<number>`count(*)::int` })
    .from(explorerSavedItems)
    .where(eq(explorerSavedItems.visitorId, input.visitorId));

  return { count, max: input.maxItems };
}
