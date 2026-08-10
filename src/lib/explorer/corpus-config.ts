import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type * as schema from "../../db/schema";
import { getCurrentLawCorpusRun } from "../legal/current-law/service";

export class ExplorerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExplorerConfigError";
  }
}

/**
 * Uniform "no usable current-law corpus" signal for EXPLORER_CORPUS_MODE=current — covers "no
 * run id configured", "run id doesn't exist", "run not completed", and "zero runtime-ready
 * entries" alike. The operator distinguishes these cases via logs/CLI (see
 * src/scripts/generate-current-law-corpus.ts); the end user always sees the same safe message
 * (see src/lib/explorer/errors.ts) — this is never surfaced as a raw error.
 */
export class CurrentCorpusNotReadyError extends Error {
  constructor(message = "No usable current-law-corpus run is configured/ready") {
    super(message);
    this.name = "CurrentCorpusNotReadyError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parses the server-only EXPLORER_TEST_LEGAL_ACT_VERSION_IDS env var: a comma-separated
 * list of legalActVersion UUIDs for the local /explorer technical test corpus (DU/1960/168,
 * historical/promulgated, currentness unproven). There is no global/default corpus fallback
 * anywhere in this pipeline — missing, empty, or malformed configuration is a hard error.
 */
export function parseExplorerTestCorpusVersionIds(raw: string | undefined): string[] {
  if (!raw || raw.trim().length === 0) {
    throw new ExplorerConfigError("EXPLORER_TEST_LEGAL_ACT_VERSION_IDS is not configured");
  }

  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  if (ids.length === 0) {
    throw new ExplorerConfigError("EXPLORER_TEST_LEGAL_ACT_VERSION_IDS is empty");
  }

  for (const id of ids) {
    if (!UUID_PATTERN.test(id)) {
      throw new ExplorerConfigError(`EXPLORER_TEST_LEGAL_ACT_VERSION_IDS contains an invalid UUID: "${id}"`);
    }
  }

  return ids;
}

/**
 * A single resolved corpus descriptor used identically for search/answer scope AND History
 * provenance, so the two can never describe different corpus state (see run-query.ts). In test
 * mode the provenance fields are null; corpusVersionIds/legalActVersionIds still carries real
 * ids either way.
 */
export interface ResolvedExplorerCorpus {
  legalActVersionIds: string[];
  corpusRunId: string | null;
  rulesetVersion: string | null;
  effectiveAsOf: string | null;
  /** The resolved run's own selectionHash (see current_law_corpus_runs) — provenance/validation metadata, e.g. for the verified legal answer cache. Null in test mode. */
  corpusSelectionHash: string | null;
}

/**
 * Resolves EXPLORER_CORPUS_MODE=current to a single pinned run's included+runtimeReady version
 * ids. `runId` is REQUIRED (not optional) — the caller must have already confirmed one is
 * configured; there is no "pick the latest usable run" fallback here (see
 * getLatestUsableCurrentLawCorpus's doc comment in service.ts for why). Returns null — never
 * throws — for every "not ready" case: the run doesn't exist, isn't `status: "completed"`, or
 * has zero included+runtimeReady entries. Callers turn that null into CurrentCorpusNotReadyError.
 */
export async function resolveCurrentCorpus(input: {
  db: PostgresJsDatabase<typeof schema>;
  runId: string;
}): Promise<ResolvedExplorerCorpus | null> {
  const run = await getCurrentLawCorpusRun({ db: input.db, runId: input.runId });
  if (!run || run.status !== "completed") {
    return null;
  }

  const legalActVersionIds = run.entries
    .filter((entry) => entry.decision === "included" && entry.runtimeReady && entry.legalActVersionId)
    .map((entry) => entry.legalActVersionId as string);

  if (legalActVersionIds.length === 0) {
    return null;
  }

  return {
    legalActVersionIds,
    corpusRunId: run.runId,
    rulesetVersion: run.rulesetVersion,
    effectiveAsOf: run.effectiveAsOf,
    corpusSelectionHash: run.selectionHash,
  };
}
