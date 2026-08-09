"use server";

import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env/server";
import { answerLegalProblem } from "@/lib/legal/answer/answer";
import { parseExplorerTestCorpusVersionIds } from "@/lib/explorer/corpus-config";
import { runExplorerQuery, type RunExplorerQueryDeps } from "@/lib/explorer/run-query";
import type { ExplorerSearchResult } from "@/lib/explorer/view-model";

const deps: RunExplorerQueryDeps = {
  getLegalActVersionIds: () => parseExplorerTestCorpusVersionIds(getServerEnv().EXPLORER_TEST_LEGAL_ACT_VERSION_IDS),
  answerLegalProblem,
  getDb,
};

/**
 * Server Action backing the /explorer search UI. All OpenAI/database/legal-answer logic
 * runs here, server-side only — the client only ever receives the sanitized view model or
 * a safe error message via `ExplorerSearchResult`, never raw pipeline internals or secrets.
 */
export async function submitExplorerQuery(query: string): Promise<ExplorerSearchResult> {
  return runExplorerQuery(query, deps);
}
