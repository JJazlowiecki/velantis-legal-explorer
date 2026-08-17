"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { clearHistory, deleteHistoryEntry, listHistoryEntries, type ClearHistoryScope } from "@/lib/explorer/history/service";
import { toHistoryListItem, type HistoryListItem } from "@/lib/explorer/history/list-view";

/** Owner-scoped, bounded list (newest first) — see listHistoryEntries for the limit. Identity comes only from the server session, never client input. */
export async function listExplorerHistory(): Promise<HistoryListItem[]> {
  const user = await getCurrentUser();
  if (!user) {
    return [];
  }

  const entries = await listHistoryEntries({ db: getDb(), userId: user.id });
  return entries.map(toHistoryListItem);
}

export async function deleteExplorerHistoryEntry(id: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: true };
  }

  try {
    await deleteHistoryEntry({ db: getDb(), userId: user.id, id });
    revalidatePath("/explorer/history");
    return { ok: true };
  } catch (error) {
    console.error("[explorer-history] delete failed:", error instanceof Error ? error.message : "unknown error");
    return { ok: false };
  }
}

export interface ClearExplorerHistoryInput {
  scope: ClearHistoryScope;
  /** ISO date strings; only used (and required) when scope === "custom". */
  from?: string;
  to?: string;
}

export async function clearExplorerHistory(input: ClearExplorerHistoryInput): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: true };
  }

  try {
    await clearHistory({
      db: getDb(),
      userId: user.id,
      scope: input.scope,
      from: input.from ? new Date(input.from) : undefined,
      to: input.to ? new Date(input.to) : undefined,
    });
    revalidatePath("/explorer/history");
    return { ok: true };
  } catch (error) {
    console.error("[explorer-history] clear failed:", error instanceof Error ? error.message : "unknown error");
    return { ok: false };
  }
}
