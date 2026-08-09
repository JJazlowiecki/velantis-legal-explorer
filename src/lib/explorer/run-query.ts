import type { answerLegalProblem, AnswerLegalProblemOptions } from "@/lib/legal/answer/answer";
import { mapErrorToSafeMessage } from "./errors";
import { validateExplorerQuery } from "./query-validation";
import { toExplorerAnswerView, type ExplorerSearchResult } from "./view-model";

export interface RunExplorerQueryDeps {
  getLegalActVersionIds: () => string[];
  answerLegalProblem: typeof answerLegalProblem;
  getDb: () => AnswerLegalProblemOptions["db"];
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

  try {
    const legalActVersionIds = deps.getLegalActVersionIds();

    const result = await deps.answerLegalProblem({
      problemDescription: validation.query,
      legalActVersionIds,
      db: deps.getDb(),
    });

    return { ok: true, data: toExplorerAnswerView(result) };
  } catch (error) {
    console.error(
      "[explorer] runExplorerQuery failed:",
      error instanceof Error ? `${error.name}: ${error.message}` : "unknown error",
    );
    return { ok: false, error: mapErrorToSafeMessage(error) };
  }
}
