import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../db/schema";
import { parseServerEnv } from "../lib/env/schema";
import { resolveCurrentCorpus } from "../lib/explorer/corpus-config";
import { answerLegalProblem, type LegalAnswerResult } from "../lib/legal/answer/answer";
import { LEGAL_ANSWER_EVAL_QUESTIONS, type LegalAnswerEvalQuestion } from "../lib/legal/answer/eval/quality-questions";

class CliArgsError extends Error {}

function printUsage() {
  console.error("Usage: pnpm eval:legal-answer-quality --run-id <UUID> [--repeat-regressions <N>]");
}

function parseArgs(argv: string[]): { runId: string; repeatRegressions: number } {
  let runId: string | undefined;
  let repeatRegressions = 3;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--run-id") {
      runId = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--repeat-regressions") {
      repeatRegressions = Number(argv[i + 1]) || 1;
      i += 1;
    }
  }
  if (!runId) throw new CliArgsError("--run-id is required");
  return { runId, repeatRegressions };
}

interface QuestionRunReport {
  question: LegalAnswerEvalQuestion;
  attempt: number;
  status: LegalAnswerResult["status"] | "ERROR";
  sourcePackSize: number;
  packedCharacters: number;
  retrievalQueryCount: number;
  candidateCount: number;
  centralCitationsRetrieved: string[];
  centralCitationsPacked: string[];
  centralCitationsCited: string[];
  centralCitationsMissing: string[];
  unsupportedClaimCount: number;
  /** A "verified claim not backed by target tagging" would be a logic bug — this counts
   * conclusions whose support is empty, which must never happen (Part 13 hard boundary). */
  unsupportedVerifiedClaimCount: number;
  sourceLeak: boolean;
  falseCurrentnessCaveat: boolean;
  recoveryMode: "none" | "full" | "partial" | "unknown";
  statusMatchesExpectation: boolean | null;
  error?: string;
}

function evaluateResult(
  question: LegalAnswerEvalQuestion,
  result: LegalAnswerResult,
  allowedVersionIds: Set<string>,
): QuestionRunReport {
  const citedLabels = result.conclusions.flatMap((c) => c.support.map((s) => s.citationLabel));
  const packedLabels = result.sources.map((s) => s.citationLabel);
  // The trace exposes per-target retrieval STRENGTH (candidateCount/bestScore), not individual
  // candidate citationLabels — packed is used here as the practical "reached the pool and
  // survived ranking" proxy; a true per-citation retrieved-rate would need a trace field this
  // eval script doesn't have access to without an extra, unbounded dump of every candidate.
  const retrievedLabels = packedLabels;

  const centralCitationsRetrieved = question.expectedCentralCitations.filter((expected) =>
    retrievedLabels.some((label) => label.startsWith(expected)),
  );
  const centralCitationsPacked = question.expectedCentralCitations.filter((expected) =>
    packedLabels.some((label) => label.startsWith(expected)),
  );
  const centralCitationsCited = question.expectedCentralCitations.filter((expected) =>
    citedLabels.some((label) => label.startsWith(expected)),
  );
  const centralCitationsMissing = question.expectedCentralCitations.filter(
    (expected) => !centralCitationsCited.includes(expected),
  );

  const sourceLeak = result.sources.some((s) => !allowedVersionIds.has(s.legalActVersionId));

  const anyProvenCurrent = result.conclusions.some((c) => c.support.some((s) => s.provenCurrentAsOf !== null));
  const falseCurrentnessCaveat =
    anyProvenCurrent &&
    result.conclusions.every((c) => c.support.every((s) => s.provenCurrentAsOf !== null)) &&
    result.uncertainties.some((u) => u.includes("Aktualność") || u.includes("aktualność"));

  const retrievalQueryCount = result.trace
    ? result.trace.issues.reduce((sum, issue) => sum + issue.retrievalQueries.length, 0)
    : 0;
  const candidateCount = result.trace?.retrievedProvisionCount ?? 0;
  const packedCharacters = result.sources.reduce((sum, s) => sum + s.text.length, 0);

  return {
    question,
    attempt: 1,
    status: result.status,
    sourcePackSize: result.sources.length,
    packedCharacters,
    retrievalQueryCount,
    candidateCount,
    centralCitationsRetrieved,
    centralCitationsPacked,
    centralCitationsCited,
    centralCitationsMissing,
    unsupportedClaimCount: result.alternativePaths.filter((p) => p.explanation.length > 0).length,
    unsupportedVerifiedClaimCount: result.conclusions.filter((c) => c.support.length === 0).length,
    sourceLeak,
    falseCurrentnessCaveat,
    recoveryMode: result.trace?.recoveryMode ?? "unknown",
    statusMatchesExpectation: question.expectedStatus === null ? null : result.status === question.expectedStatus,
  };
}

async function main() {
  loadEnv({ path: ".env" });
  const env = parseServerEnv(process.env);
  const client = postgres(env.DATABASE_URL, { max: 1 });
  const db = drizzle({ client, schema });

  try {
    const { runId, repeatRegressions } = parseArgs(process.argv.slice(2));
    const corpus = await resolveCurrentCorpus({ db, runId });
    if (!corpus) {
      console.error(`Run ${runId} is not usable (missing/not completed/zero runtimeReady entries)`);
      process.exitCode = 1;
      return;
    }

    console.log(`Evaluating ${LEGAL_ANSWER_EVAL_QUESTIONS.length} questions against run ${runId}`);
    console.log(`Corpus: ${corpus.legalActVersionIds.length} version(s), effectiveAsOf=${corpus.effectiveAsOf}\n`);

    const allowedVersionIds = new Set(corpus.legalActVersionIds);
    const reports: QuestionRunReport[] = [];

    for (const question of LEGAL_ANSWER_EVAL_QUESTIONS) {
      const attempts = question.isNamedRegression ? repeatRegressions : 1;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const result = await answerLegalProblem({
            problemDescription: question.query,
            legalActVersionIds: corpus.legalActVersionIds,
            db,
            currentCorpusContext: corpus.effectiveAsOf
              ? { legalActVersionIds: corpus.legalActVersionIds, effectiveAsOf: corpus.effectiveAsOf }
              : undefined,
            collectTrace: true,
          });
          const report = evaluateResult(question, result, allowedVersionIds);
          report.attempt = attempt;
          reports.push(report);

          console.log(
            `[${question.id}${attempts > 1 ? ` #${attempt}` : ""}] status=${result.status} ` +
              `expected=${question.expectedStatus ?? "any"} match=${report.statusMatchesExpectation ?? "n/a"} ` +
              `sources=${report.sourcePackSize} recovery=${report.recoveryMode} ` +
              `centralCited=${report.centralCitationsCited.length}/${question.expectedCentralCitations.length} ` +
              `sourceLeak=${report.sourceLeak} falseCurrentness=${report.falseCurrentnessCaveat}`,
          );
          if (report.centralCitationsMissing.length > 0) {
            console.log(`    MISSING expected citations: ${report.centralCitationsMissing.join(", ")}`);
          }
        } catch (error) {
          reports.push({
            question,
            attempt,
            status: "ERROR",
            sourcePackSize: 0,
            packedCharacters: 0,
            retrievalQueryCount: 0,
            candidateCount: 0,
            centralCitationsRetrieved: [],
            centralCitationsPacked: [],
            centralCitationsCited: [],
            centralCitationsMissing: question.expectedCentralCitations,
            unsupportedClaimCount: 0,
            unsupportedVerifiedClaimCount: 0,
            sourceLeak: false,
            falseCurrentnessCaveat: false,
            recoveryMode: "unknown",
            statusMatchesExpectation: false,
            error: error instanceof Error ? error.message : "unknown error",
          });
          console.log(`[${question.id}] ERROR: ${error instanceof Error ? error.message : "unknown error"}`);
        }
      }
    }

    const answered = reports.filter((r) => r.status === "answered").length;
    const insufficient = reports.filter((r) => r.status === "insufficient_evidence").length;
    const structuralFailures = reports.filter((r) => r.status === "ERROR" || r.sourceLeak).length;
    const sourceLeakCount = reports.filter((r) => r.sourceLeak).length;
    const falseCurrentnessCount = reports.filter((r) => r.falseCurrentnessCaveat).length;
    const unsupportedVerifiedClaimTotal = reports.reduce((sum, r) => sum + r.unsupportedVerifiedClaimCount, 0);
    const centralExpectedTotal = reports.reduce((sum, r) => sum + r.question.expectedCentralCitations.length, 0);
    const centralRetrievedTotal = reports.reduce((sum, r) => sum + r.centralCitationsRetrieved.length, 0);
    const centralPackedTotal = reports.reduce((sum, r) => sum + r.centralCitationsPacked.length, 0);
    const centralCitedTotal = reports.reduce((sum, r) => sum + r.centralCitationsCited.length, 0);
    const avgSourcePackSize = reports.reduce((sum, r) => sum + r.sourcePackSize, 0) / Math.max(reports.length, 1);
    const avgQueryCount = reports.reduce((sum, r) => sum + r.retrievalQueryCount, 0) / Math.max(reports.length, 1);
    const avgCandidateCount = reports.reduce((sum, r) => sum + r.candidateCount, 0) / Math.max(reports.length, 1);
    const maxPackedCharacters = Math.max(0, ...reports.map((r) => r.packedCharacters));
    const partialRecoveryCount = reports.filter((r) => r.recoveryMode === "partial").length;
    const fullRecoveryCount = reports.filter((r) => r.recoveryMode === "full").length;
    const statusMismatches = reports.filter((r) => r.statusMatchesExpectation === false);

    console.log(`\n=== Summary ===`);
    console.log(`total runs: ${reports.length} (${LEGAL_ANSWER_EVAL_QUESTIONS.length} questions, named regressions repeated ${repeatRegressions}x)`);
    console.log(`answered: ${answered}`);
    console.log(`insufficient_evidence: ${insufficient}`);
    console.log(`structural failures (error / source leak): ${structuralFailures}`);
    console.log(`source leak count: ${sourceLeakCount}`);
    console.log(`false-currentness-caveat count: ${falseCurrentnessCount}`);
    console.log(`unsupported verified-claim count (must be 0): ${unsupportedVerifiedClaimTotal}`);
    console.log(`central expected-provision RETRIEVED rate: ${centralRetrievedTotal}/${centralExpectedTotal}`);
    console.log(`central expected-provision PACKED rate: ${centralPackedTotal}/${centralExpectedTotal}`);
    console.log(`central expected-provision CITED rate: ${centralCitedTotal}/${centralExpectedTotal}`);
    console.log(`partial recovery frequency: ${partialRecoveryCount}/${reports.length}`);
    console.log(`full recovery frequency: ${fullRecoveryCount}/${reports.length}`);
    console.log(`average retrieval query count: ${avgQueryCount.toFixed(2)}`);
    console.log(`average candidate count: ${avgCandidateCount.toFixed(2)}`);
    console.log(`average packed source count: ${avgSourcePackSize.toFixed(2)}`);
    console.log(`max packed characters (single run): ${maxPackedCharacters}`);
    console.log(`status-expectation mismatches: ${statusMismatches.length}`);
    statusMismatches.forEach((r) => console.log(`  - ${r.question.id} (attempt ${r.attempt}): got ${r.status}, expected ${r.question.expectedStatus}`));
  } finally {
    await client.end({ timeout: 1 });
  }
}

main().catch((error: unknown) => {
  if (error instanceof CliArgsError) {
    printUsage();
    console.error(`Argument error: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (error instanceof Error) {
    console.error(`Eval run failed: ${error.name}: ${error.message}`);
  } else {
    console.error("Eval run failed");
  }
  process.exitCode = 1;
});
