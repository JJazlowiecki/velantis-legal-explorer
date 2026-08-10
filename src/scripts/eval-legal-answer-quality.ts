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
  centralCitationsFound: string[];
  centralCitationsMissing: string[];
  unsupportedClaimCount: number;
  sourceLeak: boolean;
  falseCurrentnessCaveat: boolean;
  statusMatchesExpectation: boolean | null;
  error?: string;
}

function evaluateResult(question: LegalAnswerEvalQuestion, result: LegalAnswerResult, allowedVersionIds: Set<string>): QuestionRunReport {
  const citedLabels = result.conclusions.flatMap((c) => c.support.map((s) => s.citationLabel));
  const centralCitationsFound = question.expectedCentralCitations.filter((expected) =>
    citedLabels.some((label) => label.startsWith(expected)),
  );
  const centralCitationsMissing = question.expectedCentralCitations.filter(
    (expected) => !centralCitationsFound.includes(expected),
  );

  const sourceLeak = result.sources.some((s) => !allowedVersionIds.has(s.legalActVersionId));

  // A "false currentness caveat" here means: a source is proven-current (provenCurrentAsOf set)
  // yet the generic "aktualność nie została potwierdzona" uncertainty text is still present —
  // the exact bug class buildAuthorityCurrentnessCaveats exists to prevent.
  const anyProvenCurrent = result.conclusions.some((c) => c.support.some((s) => s.provenCurrentAsOf !== null));
  const falseCurrentnessCaveat =
    anyProvenCurrent &&
    result.conclusions.every((c) => c.support.every((s) => s.provenCurrentAsOf !== null)) &&
    result.uncertainties.some((u) => u.includes("Aktualność") || u.includes("aktualność"));

  return {
    question,
    attempt: 1,
    status: result.status,
    sourcePackSize: result.sources.length,
    centralCitationsFound,
    centralCitationsMissing,
    unsupportedClaimCount: result.alternativePaths.filter((p) => p.explanation.length > 0).length,
    sourceLeak,
    falseCurrentnessCaveat,
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
          });
          const report = evaluateResult(question, result, allowedVersionIds);
          report.attempt = attempt;
          reports.push(report);

          console.log(
            `[${question.id}${attempts > 1 ? ` #${attempt}` : ""}] status=${result.status} ` +
              `expected=${question.expectedStatus ?? "any"} match=${report.statusMatchesExpectation ?? "n/a"} ` +
              `sources=${report.sourcePackSize} centralHit=${report.centralCitationsFound.length}/${question.expectedCentralCitations.length} ` +
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
            centralCitationsFound: [],
            centralCitationsMissing: question.expectedCentralCitations,
            unsupportedClaimCount: 0,
            sourceLeak: false,
            falseCurrentnessCaveat: false,
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
    const centralExpectedTotal = reports.reduce((sum, r) => sum + r.question.expectedCentralCitations.length, 0);
    const centralHitTotal = reports.reduce((sum, r) => sum + r.centralCitationsFound.length, 0);
    const avgSourcePackSize =
      reports.reduce((sum, r) => sum + r.sourcePackSize, 0) / Math.max(reports.length, 1);
    const statusMismatches = reports.filter((r) => r.statusMatchesExpectation === false);

    console.log(`\n=== Summary ===`);
    console.log(`total runs: ${reports.length} (${LEGAL_ANSWER_EVAL_QUESTIONS.length} questions, named regressions repeated ${repeatRegressions}x)`);
    console.log(`answered: ${answered}`);
    console.log(`insufficient_evidence: ${insufficient}`);
    console.log(`structural failures (error / source leak): ${structuralFailures}`);
    console.log(`source leak count: ${sourceLeakCount}`);
    console.log(`false-currentness-caveat count: ${falseCurrentnessCount}`);
    console.log(`central expected-citation hit rate: ${centralHitTotal}/${centralExpectedTotal}`);
    console.log(`average packed source count: ${avgSourcePackSize.toFixed(2)}`);
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
