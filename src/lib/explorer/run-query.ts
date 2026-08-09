import type { answerLegalProblem, AnswerLegalProblemOptions, LegalAnswerResult } from "@/lib/legal/answer/answer";
import { mapErrorToSafeMessage } from "./errors";
import { validateExplorerQuery } from "./query-validation";
import { toExplorerAnswerView, type ExplorerAnswerView, type ExplorerSearchResult } from "./view-model";

export interface RecordHistoryEntryInput {
  query: string;
  result: LegalAnswerResult;
  view: ExplorerAnswerView;
}

export type RecordHistoryEntryFn = (input: RecordHistoryEntryInput) => Promise<{ id: string }>;

export interface RunExplorerQueryDeps {
  getLegalActVersionIds: () => string[];
  answerLegalProblem: typeof answerLegalProblem;
  getDb: () => AnswerLegalProblemOptions["db"];
  /**
   * Optional: undefined means history is disabled (or not wired up) and no write is
   * attempted at all. When present, a write failure is caught and logged but NEVER changes
   * the `ExplorerSearchResult` returned to the caller — a successfully generated legal
   * answer must never be replaced by a history-persistence error.
   */
  recordHistoryEntry?: RecordHistoryEntryFn;
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

  let result: LegalAnswerResult;
  try {
    const legalActVersionIds = deps.getLegalActVersionIds();

    result = await deps.answerLegalProblem({
      problemDescription: validation.query,
      legalActVersionIds,
      db: deps.getDb(),
    });
  } catch (error) {
    console.error(
      "[explorer] runExplorerQuery failed:",
      error instanceof Error ? `${error.name}: ${error.message}` : "unknown error",
    );
    return { ok: false, error: mapErrorToSafeMessage(error) };
  }

  const view = toExplorerAnswerView(result);

  // History is only ever recorded for a pipeline that actually completed (answered or
  // insufficient_evidence) — input-validation failures, OpenAI/config/search errors never
  // reach this point (they returned early above). A history write failure is swallowed here:
  // the user still gets the answer they were just given. The returned id (when the write
  // succeeds) lets the client Save the exact server-validated snapshot later without ever
  // re-sending answer JSON from the browser — see src/app/explorer/saved/actions.ts.
  let historyEntryId: string | undefined;
  if (deps.recordHistoryEntry) {
    try {
      const entry = await deps.recordHistoryEntry({ query: validation.query, result, view });
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
