"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env/server";
import { getCurrentUser } from "@/lib/auth/session";
import { buildContentKey, normalizeQueryForContentKey } from "@/lib/explorer/saved/content-key";
import { toSavedListItem, type SavedListItem } from "@/lib/explorer/saved/list-view";
import {
  createSavedFolder,
  createSavedItem,
  deleteSavedFolder,
  deleteSavedItem,
  getSavedItem,
  getSavedUsage,
  listSavedFolders,
  listSavedItems,
  moveSavedItem,
  renameSavedFolder,
  type SavedFolderRecord,
  type SavedUsage,
} from "@/lib/explorer/saved/service";
import type {
  SavedAnswerSnapshot,
  SavedItemKind,
  SavedProvisionSnapshot,
  SavedSnapshot,
} from "@/lib/explorer/saved/snapshot";
import { explorerHistoryCitedSourceSchema, explorerHistorySnapshotSchema } from "@/lib/explorer/history/snapshot";
import { getHistoryEntry } from "@/lib/explorer/history/service";
import { getOrCreateVisitorId } from "@/lib/explorer/history/visitor";
import type { ExplorerAnswerView, ExplorerCitedSource } from "@/lib/explorer/view-model";

const ANSWER_TITLE_MAX_LENGTH = 120;

function buildAnswerTitle(query: string): string {
  const trimmed = query.trim();
  return trimmed.length > ANSWER_TITLE_MAX_LENGTH ? `${trimmed.slice(0, ANSWER_TITLE_MAX_LENGTH - 1)}…` : trimmed;
}

function buildProvisionTitle(provision: { citationLabel: string; actTitle: string }): string {
  return `${provision.citationLabel} — ${provision.actTitle}`;
}

function getSavedMaxItems(): number {
  return getServerEnv().EXPLORER_SAVED_MAX_ITEMS;
}

export type SaveOutcome =
  | { status: "created"; id: string }
  | { status: "already_saved"; id: string }
  | { status: "quota_exceeded"; limit: number }
  | { status: "not_found" }
  | { status: "error" };

function safeLog(context: string, error: unknown): void {
  console.error(`[explorer-saved] ${context}:`, error instanceof Error ? error.message : "unknown error");
}

/**
 * Save a full answer server-side, sourced from an already-persisted, server-validated History
 * entry — never from client-submitted answer JSON. This is the primary, preferred save path:
 * both the live /explorer result (which receives a historyEntryId as soon as the search
 * completes, see submitExplorerQuery) and the History list/detail UIs always have a
 * historyEntryId to save from. The Saved row copies its own snapshot out of the History
 * entry — it does not reference historyEntryId for future reads, so it survives History being
 * deleted later (by the user or by future retention).
 */
export async function saveAnswerFromHistory(historyEntryId: string, folderId: string | null = null): Promise<SaveOutcome> {
  const user = await getCurrentUser();
  if (!user) {
    return { status: "not_found" };
  }

  const entry = await getHistoryEntry({ db: getDb(), userId: user.id, id: historyEntryId });
  if (!entry) {
    return { status: "not_found" };
  }

  const snapshot: SavedAnswerSnapshot = {
    query: entry.query,
    status: entry.snapshot.status,
    answer: entry.snapshot.answer,
    conclusions: entry.snapshot.conclusions,
    alternativePaths: entry.snapshot.alternativePaths,
    uncertainties: entry.snapshot.uncertainties,
    citedSources: entry.snapshot.citedSources,
    clarificationQuestion: entry.snapshot.clarificationQuestion,
  };

  return persistAnswer(user.id, entry.query, snapshot, buildContentKey("answer", historyEntryId), folderId);
}

/**
 * Fallback save path for a full answer, used ONLY when no historyEntryId is available (History
 * disabled, or the history write failed) — see the security note in the milestone spec: we
 * never blindly trust arbitrary client JSON. The payload is re-validated against the exact
 * same Zod schema already trusted for History snapshots (structurally identical to
 * ExplorerAnswerView) before anything is persisted; a payload that doesn't match that shape is
 * rejected outright.
 */
export async function saveAnswerFromPayload(
  query: string,
  view: ExplorerAnswerView,
  folderId: string | null = null,
): Promise<SaveOutcome> {
  const user = await getCurrentUser();
  if (!user) {
    return { status: "not_found" };
  }

  const validated = explorerHistorySnapshotSchema.safeParse(view);
  if (!validated.success) {
    safeLog("rejected save-answer-from-payload with a malformed view model", validated.error);
    return { status: "error" };
  }

  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return { status: "error" };
  }

  const snapshot: SavedAnswerSnapshot = { query: normalizedQuery, ...validated.data };
  const contentKey = buildContentKey("answer", `${normalizeQueryForContentKey(normalizedQuery)}|${validated.data.answer}`);

  return persistAnswer(user.id, normalizedQuery, snapshot, contentKey, folderId);
}

async function persistAnswer(
  userId: string,
  query: string,
  snapshot: SavedAnswerSnapshot,
  contentKey: string,
  folderId: string | null,
): Promise<SaveOutcome> {
  try {
    const visitorId = await getOrCreateVisitorId();
    const result = await createSavedItem({
      db: getDb(),
      userId,
      visitorId,
      kind: "answer",
      title: buildAnswerTitle(query),
      query,
      folderId,
      snapshot,
      contentKey,
      maxItems: getSavedMaxItems(),
    });
    revalidatePath("/explorer/saved");
    return mapCreateSavedItemResult(result);
  } catch (error) {
    safeLog("save answer failed", error);
    return { status: "error" };
  }
}

/** Save a query/search — sourced from a History entry's own (already-validated) query. */
export async function saveSearchFromHistory(historyEntryId: string, folderId: string | null = null): Promise<SaveOutcome> {
  const user = await getCurrentUser();
  if (!user) {
    return { status: "not_found" };
  }

  const entry = await getHistoryEntry({ db: getDb(), userId: user.id, id: historyEntryId });
  if (!entry) {
    return { status: "not_found" };
  }

  return persistSearch(user.id, entry.query, folderId);
}

/** Fallback: save a query typed/submitted directly (e.g. from the live search box), no history entry required. */
export async function saveSearchFromQuery(query: string, folderId: string | null = null): Promise<SaveOutcome> {
  const user = await getCurrentUser();
  if (!user) {
    return { status: "not_found" };
  }
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return { status: "error" };
  }
  return persistSearch(user.id, normalizedQuery, folderId);
}

async function persistSearch(userId: string, query: string, folderId: string | null): Promise<SaveOutcome> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { status: "error" };
  }

  try {
    const visitorId = await getOrCreateVisitorId();
    const result = await createSavedItem({
      db: getDb(),
      userId,
      visitorId,
      kind: "search",
      title: buildAnswerTitle(trimmed),
      query: trimmed,
      folderId,
      snapshot: { query: trimmed },
      contentKey: buildContentKey("search", normalizeQueryForContentKey(trimmed)),
      maxItems: getSavedMaxItems(),
    });
    revalidatePath("/explorer/saved");
    return mapCreateSavedItemResult(result);
  } catch (error) {
    safeLog("save search failed", error);
    return { status: "error" };
  }
}

/**
 * Save one individual cited provision, sourced server-side from a History entry's own
 * `citedSources` array by index — never from a client-submitted provision object, for the
 * same provenance reason as saveAnswerFromHistory.
 */
export async function saveProvisionFromHistory(
  historyEntryId: string,
  sourceIndex: number,
  folderId: string | null = null,
): Promise<SaveOutcome> {
  const user = await getCurrentUser();
  if (!user) {
    return { status: "not_found" };
  }

  const entry = await getHistoryEntry({ db: getDb(), userId: user.id, id: historyEntryId });
  if (!entry) {
    return { status: "not_found" };
  }

  const source = entry.snapshot.citedSources[sourceIndex];
  if (!source) {
    return { status: "not_found" };
  }

  return persistProvision(user.id, source, folderId);
}

/** Fallback: save a provision straight from a live (not-yet-historied) result — Zod-validated, never trusted blindly. */
export async function saveProvisionFromPayload(
  provision: ExplorerCitedSource,
  folderId: string | null = null,
): Promise<SaveOutcome> {
  const user = await getCurrentUser();
  if (!user) {
    return { status: "not_found" };
  }

  const validated = explorerHistoryCitedSourceSchema.safeParse(provision);
  if (!validated.success) {
    safeLog("rejected save-provision-from-payload with a malformed provision", validated.error);
    return { status: "error" };
  }

  return persistProvision(user.id, validated.data, folderId);
}

async function persistProvision(
  userId: string,
  provision: SavedProvisionSnapshot,
  folderId: string | null,
): Promise<SaveOutcome> {
  try {
    const visitorId = await getOrCreateVisitorId();
    const result = await createSavedItem({
      db: getDb(),
      userId,
      visitorId,
      kind: "provision",
      title: buildProvisionTitle(provision),
      query: null,
      folderId,
      snapshot: provision,
      contentKey: buildContentKey("provision", `${provision.actTitle}|${provision.citationLabel}|${provision.text}`),
      maxItems: getSavedMaxItems(),
    });
    revalidatePath("/explorer/saved");
    return mapCreateSavedItemResult(result);
  } catch (error) {
    safeLog("save provision failed", error);
    return { status: "error" };
  }
}

function mapCreateSavedItemResult(
  result: Awaited<ReturnType<typeof createSavedItem>>,
): SaveOutcome {
  switch (result.status) {
    case "created":
      return { status: "created", id: result.id };
    case "already_saved":
      return { status: "already_saved", id: result.id };
    case "quota_exceeded":
      return { status: "quota_exceeded", limit: result.limit };
    case "folder_not_found":
      return { status: "not_found" };
  }
}

export interface SavedListPayload {
  items: SavedListItem[];
  folders: SavedFolderRecord[];
  usage: SavedUsage;
}

/** Owner-scoped, bounded (see listSavedItems), always returns a consistent triple for the page. */
export async function listSaved(): Promise<SavedListPayload> {
  const user = await getCurrentUser();
  if (!user) {
    return { items: [], folders: [], usage: { count: 0, max: getSavedMaxItems() } };
  }

  const db = getDb();
  const [records, folders, usage] = await Promise.all([
    listSavedItems({ db, userId: user.id }),
    listSavedFolders({ db, userId: user.id }),
    getSavedUsage({ db, userId: user.id, maxItems: getSavedMaxItems() }),
  ]);

  return { items: records.map(toSavedListItem), folders, usage };
}

export interface SavedItemDetail {
  id: string;
  kind: SavedItemKind;
  title: string;
  query: string | null;
  folderId: string | null;
  createdAt: string;
  snapshot: SavedSnapshot;
}

/** Owner-scoped detail lookup for the preview modal — never re-runs anything, just reads the stored snapshot. */
export async function getSavedItemDetail(id: string): Promise<SavedItemDetail | null> {
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }

  const record = await getSavedItem({ db: getDb(), userId: user.id, id });
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    kind: record.kind,
    title: record.title,
    query: record.query,
    folderId: record.folderId,
    createdAt: record.createdAt.toISOString(),
    snapshot: record.snapshot,
  };
}

export type FolderOutcome =
  | { status: "created" | "renamed"; id?: string }
  | { status: "invalid_name" }
  | { status: "duplicate_name" }
  | { status: "limit_exceeded"; limit: number }
  | { status: "not_found" }
  | { status: "error" };

export async function createSavedFolderAction(name: string): Promise<FolderOutcome> {
  const user = await getCurrentUser();
  if (!user) {
    return { status: "not_found" };
  }

  try {
    const visitorId = await getOrCreateVisitorId();
    const result = await createSavedFolder({ db: getDb(), userId: user.id, visitorId, name });
    revalidatePath("/explorer/saved");

    if (result.status === "created") return { status: "created", id: result.id };
    if (result.status === "invalid_name") return { status: "invalid_name" };
    if (result.status === "duplicate_name") return { status: "duplicate_name" };
    return { status: "limit_exceeded", limit: result.limit };
  } catch (error) {
    safeLog("create folder failed", error);
    return { status: "error" };
  }
}

export async function renameSavedFolderAction(id: string, name: string): Promise<FolderOutcome> {
  const user = await getCurrentUser();
  if (!user) {
    return { status: "not_found" };
  }

  try {
    const result = await renameSavedFolder({ db: getDb(), userId: user.id, id, name });
    revalidatePath("/explorer/saved");

    if (result.status === "renamed") return { status: "renamed" };
    if (result.status === "not_found") return { status: "not_found" };
    if (result.status === "invalid_name") return { status: "invalid_name" };
    return { status: "duplicate_name" };
  } catch (error) {
    safeLog("rename folder failed", error);
    return { status: "error" };
  }
}

export async function deleteSavedFolderAction(id: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: true };
  }

  try {
    await deleteSavedFolder({ db: getDb(), userId: user.id, id });
    revalidatePath("/explorer/saved");
    return { ok: true };
  } catch (error) {
    safeLog("delete folder failed", error);
    return { ok: false };
  }
}

export async function moveSavedItemAction(id: string, folderId: string | null): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: true };
  }

  try {
    const result = await moveSavedItem({ db: getDb(), userId: user.id, id, folderId });
    revalidatePath("/explorer/saved");
    return { ok: result.status === "moved" };
  } catch (error) {
    safeLog("move saved item failed", error);
    return { ok: false };
  }
}

export async function deleteSavedItemAction(id: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: true };
  }

  try {
    await deleteSavedItem({ db: getDb(), userId: user.id, id });
    revalidatePath("/explorer/saved");
    return { ok: true };
  } catch (error) {
    safeLog("delete saved item failed", error);
    return { ok: false };
  }
}

export type { SavedItemKind };
