"use server";

import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env/server";
import { getCurrentUser } from "@/lib/auth/session";
import { resolveEntitlement } from "@/lib/billing/entitlement";
import { releaseQuotaUnit, reserveQuotaUnit } from "@/lib/billing/quota";
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

function recordHistoryEntryFor(userId: string) {
  return async function recordHistoryEntry({ query, result, view, corpus }: RecordHistoryEntryInput): Promise<{ id: string }> {
    const visitorId = await getOrCreateVisitorId();
    const entry = await createHistoryEntry({
      db: getDb(),
      visitorId,
      userId,
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
      userId,
      retentionDays: env.EXPLORER_HISTORY_RETENTION_DAYS,
      maxEntries: env.EXPLORER_HISTORY_MAX_ENTRIES,
    });

    return entry;
  };
}

/**
 * Server Action backing the /explorer search UI. All OpenAI/database/legal-answer logic
 * runs here, server-side only — the client only ever receives the sanitized view model or
 * a safe error message via `ExplorerSearchResult`, never raw pipeline internals or secrets.
 *
 * Flow (Production & Monetization v1): session -> entitlement -> atomic quota reservation ->
 * existing runExplorerQuery/cache/legal pipeline -> finalize quota -> History. Identity is
 * ALWAYS derived from the server session (getCurrentUser), never trusted from the client.
 * `/explorer` is already middleware-protected, but this action re-checks independently —
 * middleware is a UX convenience, never the sole authorization boundary (see CLAUDE.md).
 * A quota-exhausted or unauthenticated request makes ZERO legal-pipeline/OpenAI calls.
 */
export async function submitExplorerQuery(query: string): Promise<ExplorerSearchResult> {
  const env = getServerEnv();

  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Musisz być zalogowany, aby korzystać z Explorera." };
  }

  const db = getDb();
  const entitlement = await resolveEntitlement(db, user.id);
  const reservation = await reserveQuotaUnit(db, user.id, entitlement.monthlyQueryLimit);
  if (!reservation.reserved) {
    return { ok: false, error: "QUOTA_EXCEEDED" };
  }

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
    recordHistoryEntry: env.EXPLORER_HISTORY_ENABLED ? recordHistoryEntryFor(user.id) : undefined,
    // Both no-op automatically outside CURRENT corpus mode (see hasCurrentCorpusIdentity in
    // cache/service.ts) — safe to always wire, no mode branch needed here.
    lookupCachedAnswer: ({ question, corpus }) => lookupVerifiedAnswer({ db: getDb(), question, corpus }),
    recordCachedAnswer: ({ question, corpus, result, view }) =>
      recordVerifiedAnswer({ db: getDb(), question, corpus, result, view }),
  };

  const outcome = await runExplorerQuery(query, deps);

  // `ok:false` here is ALWAYS an infrastructure/validation failure (runExplorerQuery never
  // throws and maps every genuine product outcome — including "answered" and
  // "insufficient_evidence" — to `ok:true`; see its own doc comment) — release the reserved
  // unit. `ok:true` (any status, including a cache hit) keeps it: quota represents product
  // usage, not only OpenAI cost.
  if (!outcome.ok) {
    await releaseQuotaUnit(db, user.id);
  }

  return outcome;
}
