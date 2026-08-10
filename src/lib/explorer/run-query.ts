import type { answerLegalProblem, AnswerLegalProblemOptions, LegalAnswerResult, LegalAnswerStatus } from "@/lib/legal/answer/answer";
import { mapErrorToSafeMessage } from "./errors";
import { validateExplorerQuery } from "./query-validation";
import { toExplorerAnswerView, type ExplorerAnswerView, type ExplorerSearchResult } from "./view-model";

/**
 * The corpus resolved ONCE per query, before search/answer runs — the SAME descriptor is then
 * used for `legalActVersionIds` (search/answer scope), History provenance
 * (`corpusRunId`/`rulesetVersion`/`effectiveAsOf`), AND the verified legal answer cache
 * (`corpusSelectionHash` additionally), so none of the three can ever describe different
 * corpus state. All provenance fields are null in historical test mode.
 */
export interface ResolvedQueryCorpus {
  legalActVersionIds: string[];
  corpusRunId: string | null;
  rulesetVersion: string | null;
  effectiveAsOf: string | null;
  corpusSelectionHash: string | null;
}

/**
 * Only what History actually needs to know about the answer result — deliberately NOT the full
 * `LegalAnswerResult` (which a cache hit cannot faithfully reconstruct, since the safe cached
 * `ExplorerAnswerView` snapshot never carries internal ids). A real `LegalAnswerResult` still
 * satisfies this structurally, so the live-pipeline call site needs no change.
 */
export interface HistoryAnswerSummary {
  status: LegalAnswerStatus;
  legalActVersionIds: string[];
}

export interface RecordHistoryEntryInput {
  query: string;
  result: HistoryAnswerSummary;
  view: ExplorerAnswerView;
  corpus: ResolvedQueryCorpus;
}

export type RecordHistoryEntryFn = (input: RecordHistoryEntryInput) => Promise<{ id: string }>;

/**
 * Verified legal answer cache hooks (see src/lib/explorer/cache/service.ts) — current-mode-
 * only, exact-match. Omit either (or both) to disable caching entirely; the normal pipeline
 * always still runs correctly with no cache wired up (this is exactly test mode's behavior,
 * unchanged). `lookupCachedAnswer` returning non-null MUST mean `answerLegalProblem` is never
 * called for this request — that is the whole point of the cache.
 */
export type LookupCachedAnswerFn = (input: {
  question: string;
  corpus: ResolvedQueryCorpus;
}) => Promise<ExplorerAnswerView | null>;

export type RecordCachedAnswerFn = (input: {
  question: string;
  corpus: ResolvedQueryCorpus;
  result: LegalAnswerResult;
  view: ExplorerAnswerView;
}) => Promise<void>;

export interface RunExplorerQueryDeps {
  getCorpus: () => Promise<ResolvedQueryCorpus>;
  answerLegalProblem: typeof answerLegalProblem;
  getDb: () => AnswerLegalProblemOptions["db"];
  /**
   * Optional: undefined means history is disabled (or not wired up) and no write is
   * attempted at all. When present, a write failure is caught and logged but NEVER changes
   * the `ExplorerSearchResult` returned to the caller — a successfully generated legal
   * answer must never be replaced by a history-persistence error.
   */
  recordHistoryEntry?: RecordHistoryEntryFn;
  lookupCachedAnswer?: LookupCachedAnswerFn;
  recordCachedAnswer?: RecordCachedAnswerFn;
}

/**
 * The actual implementation behind the /explorer search UI, kept free of any server-only
 * imports (no `@/db`, no `@/lib/env/server`) so it can be unit-tested directly in plain
 * Node/vitest with injected fakes (no OpenAI, no database, no real env) — the real
 * dependencies are wired up by the "use server" action in src/app/explorer/actions.ts.
 * Never throws — every failure mode (validation, missing test-corpus config, OpenAI errors,
 * search/DB errors, unexpected errors) is mapped to a safe `ExplorerSearchResult`.
 */
export async function runExplorerQuery(rawQuery: unknown, deps: RunExplorerQueryDeps): Promise<ExplorerSearchResult> {
  const validation = validateExplorerQuery(rawQuery);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  let view: ExplorerAnswerView;
  let historyResult: HistoryAnswerSummary;
  let corpus: ResolvedQueryCorpus;
  try {
    corpus = await deps.getCorpus();

    // Cache lookup happens BEFORE the answer pipeline runs at all — a valid exact hit means
    // issue detection, retrieval-query generation, embeddings, answer generation, verification,
    // skeptic, and recovery are never invoked for this request (see cache/service.ts for the
    // full validation this must pass; any failure there is a plain miss, never an error here).
    const cachedView = deps.lookupCachedAnswer ? await deps.lookupCachedAnswer({ question: validation.query, corpus }) : null;

    if (cachedView) {
      view = cachedView;
      historyResult = { status: cachedView.status, legalActVersionIds: corpus.legalActVersionIds };
    } else {
      // corpusRunId non-null <=> Explorer resolved a CURRENT-mode corpus for this query — every
      // id in corpus.legalActVersionIds is then an authoritative_current entry of that one
      // pinned run (see resolveCurrentCorpus), so it's safe to pass the whole scope through as
      // the "confirmed current as of effectiveAsOf" context. Omitted entirely in test mode.
      const result = await deps.answerLegalProblem({
        problemDescription: validation.query,
        legalActVersionIds: corpus.legalActVersionIds,
        db: deps.getDb(),
        currentCorpusContext:
          corpus.corpusRunId && corpus.effectiveAsOf
            ? { legalActVersionIds: corpus.legalActVersionIds, effectiveAsOf: corpus.effectiveAsOf }
            : undefined,
      });
      view = toExplorerAnswerView(result);
      historyResult = { status: result.status, legalActVersionIds: result.legalActVersionIds };

      if (deps.recordCachedAnswer) {
        try {
          await deps.recordCachedAnswer({ question: validation.query, corpus, result, view });
        } catch (error) {
          console.error(
            "[explorer] answer-cache write failed (answer already returned to the user):",
            error instanceof Error ? `${error.name}: ${error.message}` : "unknown error",
          );
        }
      }
    }
  } catch (error) {
    console.error(
      "[explorer] runExplorerQuery failed:",
      error instanceof Error ? `${error.name}: ${error.message}` : "unknown error",
    );
    return { ok: false, error: mapErrorToSafeMessage(error) };
  }

  // History is only ever recorded for a pipeline that actually completed (answered or
  // insufficient_evidence, including a cache hit — which is always "answered") — input-
  // validation failures, OpenAI/config/search errors never reach this point (they returned
  // early above). A history write failure is swallowed here: the user still gets the answer
  // they were just given. The returned id (when the write succeeds) lets the client Save the
  // exact server-validated snapshot later without ever re-sending answer JSON from the browser
  // — see src/app/explorer/saved/actions.ts. Cache hits still create a normal History entry:
  // History is user activity, the cache is an engine optimization — they are never deduplicated
  // against each other.
  let historyEntryId: string | undefined;
  if (deps.recordHistoryEntry) {
    try {
      const entry = await deps.recordHistoryEntry({ query: validation.query, result: historyResult, view, corpus });
      historyEntryId = entry.id;
    } catch (error) {
      console.error(
        "[explorer] history write failed (answer still returned to the user):",
        error instanceof Error ? `${error.name}: ${error.message}` : "unknown error",
      );
    }
  }

  return { ok: true, data: view, historyEntryId };
}
