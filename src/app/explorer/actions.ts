"use server";

import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env/server";
import { answerLegalProblem } from "@/lib/legal/answer/answer";
import { lookupVerifiedAnswer, recordVerifiedAnswer } from "@/lib/explorer/cache/service";
import {
  CurrentCorpusNotReadyError,
  parseExplorerTestCorpusVersionIds,
  resolveCurrentCorpus,
} from "@/lib/explorer/corpus-config";
import { createHistoryEntry, safeCleanupHistoryForVisitor } from "@/lib/explorer/history/service";
import { getOrCreateVisitorId } from "@/lib/explorer/history/visitor";
import { runExplorerQuery, type RecordHistoryEntryInput, type RunExplorerQueryDeps } from "@/lib/explorer/run-query";
import type { ExplorerSearchResult } from "@/lib/explorer/view-model";

async function recordHistoryEntry({ query, result, view, corpus }: RecordHistoryEntryInput): Promise<{ id: string }> {
  const visitorId = await getOrCreateVisitorId();
  const entry = await createHistoryEntry({
    db: getDb(),
    visitorId,
    query,
    status: result.status,
    snapshot: view,
    corpusVersionIds: result.legalActVersionIds,
    corpusProvenance: {
      corpusRunId: corpus.corpusRunId,
      rulesetVersion: corpus.rulesetVersion,
      effectiveAsOf: corpus.effectiveAsOf,
    },
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
    getCorpus: async () => {
      if (env.EXPLORER_CORPUS_MODE === "test") {
        return {
          legalActVersionIds: parseExplorerTestCorpusVersionIds(env.EXPLORER_TEST_LEGAL_ACT_VERSION_IDS),
          corpusRunId: null,
          rulesetVersion: null,
          effectiveAsOf: null,
          corpusSelectionHash: null,
        };
      }

      // "current" mode REQUIRES an explicitly pinned run id — no id configured is itself a
      // fail-closed "not ready" state, never an implicit "use whatever's latest" fallback.
      if (!env.EXPLORER_CURRENT_CORPUS_RUN_ID) {
        throw new CurrentCorpusNotReadyError();
      }
      const resolved = await resolveCurrentCorpus({ db: getDb(), runId: env.EXPLORER_CURRENT_CORPUS_RUN_ID });
      if (!resolved) {
        throw new CurrentCorpusNotReadyError();
      }
      return resolved;
    },
    answerLegalProblem,
    getDb,
    recordHistoryEntry: env.EXPLORER_HISTORY_ENABLED ? recordHistoryEntry : undefined,
    // Both no-op automatically outside CURRENT corpus mode (see hasCurrentCorpusIdentity in
    // cache/service.ts) — safe to always wire, no mode branch needed here.
    lookupCachedAnswer: ({ question, corpus }) => lookupVerifiedAnswer({ db: getDb(), question, corpus }),
    recordCachedAnswer: ({ question, corpus, result, view }) =>
      recordVerifiedAnswer({ db: getDb(), question, corpus, result, view }),
  };

  return runExplorerQuery(query, deps);
}
