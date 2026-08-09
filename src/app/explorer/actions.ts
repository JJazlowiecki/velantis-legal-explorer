"use server";

import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env/server";
import { answerLegalProblem } from "@/lib/legal/answer/answer";
import { parseExplorerTestCorpusVersionIds } from "@/lib/explorer/corpus-config";
import { createHistoryEntry, safeCleanupHistoryForVisitor } from "@/lib/explorer/history/service";
import { getOrCreateVisitorId } from "@/lib/explorer/history/visitor";
import { runExplorerQuery, type RecordHistoryEntryInput, type RunExplorerQueryDeps } from "@/lib/explorer/run-query";
import type { ExplorerSearchResult } from "@/lib/explorer/view-model";

async function recordHistoryEntry({ query, result, view }: RecordHistoryEntryInput): Promise<{ id: string }> {
  const visitorId = await getOrCreateVisitorId();
  const entry = await createHistoryEntry({
    db: getDb(),
    visitorId,
    query,
    status: result.status,
    snapshot: view,
    corpusVersionIds: result.legalActVersionIds,
  });

  // Opportunistic cleanup, run right after a successful write. safeCleanupHistoryForVisitor
  // never rejects, so a cleanup problem can never discard the entry we just created (and
  // returned to the caller for e.g. Save) — this is on top of the outer try/catch in
  // run-query.ts that already protects the legal answer itself from any history-related
  // failure.
  const env = getServerEnv();
  await safeCleanupHistoryForVisitor({
    db: getDb(),
    visitorId,
    retentionDays: env.EXPLORER_HISTORY_RETENTION_DAYS,
    maxEntries: env.EXPLORER_HISTORY_MAX_ENTRIES,
  });

  return entry;
}

/**
 * Server Action backing the /explorer search UI. All OpenAI/database/legal-answer logic
 * runs here, server-side only — the client only ever receives the sanitized view model or
 * a safe error message via `ExplorerSearchResult`, never raw pipeline internals or secrets.
 */
export async function submitExplorerQuery(query: string): Promise<ExplorerSearchResult> {
  const env = getServerEnv();

  const deps: RunExplorerQueryDeps = {
    getLegalActVersionIds: () => parseExplorerTestCorpusVersionIds(env.EXPLORER_TEST_LEGAL_ACT_VERSION_IDS),
    answerLegalProblem,
    getDb,
    recordHistoryEntry: env.EXPLORER_HISTORY_ENABLED ? recordHistoryEntry : undefined,
  };

  return runExplorerQuery(query, deps);
}
