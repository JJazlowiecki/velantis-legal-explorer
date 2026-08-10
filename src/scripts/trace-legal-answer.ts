import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../db/schema";
import { parseServerEnv } from "../lib/env/schema";
import { answerLegalProblem, LegalAnswerError } from "../lib/legal/answer/answer";

class CliArgsError extends Error {}

function printUsage() {
  console.error(
    'Usage: pnpm trace:legal-answer --version-id <UUID> [--version-id <UUID> ...] --query "..."',
  );
}

function parseArgs(argv: string[]): { versionIds: string[]; query: string } {
  const versionIds: string[] = [];
  let query: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--version-id") {
      const value = argv[i + 1];
      if (!value) throw new CliArgsError("Missing value for --version-id");
      versionIds.push(value);
      i += 1;
      continue;
    }
    if (current === "--query") {
      const value = argv[i + 1];
      if (!value) throw new CliArgsError("Missing value for --query");
      query = value;
      i += 1;
      continue;
    }
    throw new CliArgsError(`Unexpected argument: ${current}`);
  }

  if (versionIds.length === 0) throw new CliArgsError("At least one --version-id is required");
  if (!query) throw new CliArgsError("--query is required");
  return { versionIds, query };
}

/**
 * Internal developer explainability tool (Phase 13 of CORE LEGAL ANSWER QUALITY v4): a
 * permanent, reusable replacement for the one-off diagnostic scripts previously written and
 * thrown away during live investigations. Prints the full `LegalAnswerTrace` — answerTargets,
 * issues/queries, retrieval counts, packing decisions (including which sources were RESERVED
 * for which answerTarget), raw generate/verify/skeptic outputs, and final target coverage.
 * Never wired into the Explorer UI/runtime; makes real OpenAI + DB calls when run.
 */
async function main() {
  loadEnv({ path: ".env" });
  const env = parseServerEnv(process.env);
  const client = postgres(env.DATABASE_URL, { max: 1 });
  const db = drizzle({ client, schema });

  try {
    const { versionIds, query } = parseArgs(process.argv.slice(2));

    const result = await answerLegalProblem({
      problemDescription: query,
      legalActVersionIds: versionIds,
      db,
      collectTrace: true,
    });

    if (!result.trace) {
      throw new LegalAnswerError("collectTrace was requested but no trace was returned — this is a library bug");
    }
    const trace = result.trace;

    console.log("QUERY");
    console.log(query);
    console.log("");

    console.log(`STATUS: ${result.status}`);
    console.log("");

    console.log("ANSWER TARGETS");
    if (trace.answerTargets.length === 0) {
      console.log("(none)");
    } else {
      trace.answerTargets.forEach((t) => console.log(`[${t.index}] ${t.text}`));
    }
    console.log("");

    console.log("ISSUES / RETRIEVAL QUERIES");
    trace.issues.forEach((issue) => {
      console.log(`- ${issue.label} (${issue.likelihood}) -> targets [${issue.answerTargetIndexes.join(", ")}]`);
      issue.retrievalQueries.forEach((q) => console.log(`    query: "${q.query}" (target ${q.answerTargetIndex})`));
    });
    console.log("");

    console.log(`RETRIEVED PROVISIONS (deduplicated): ${trace.retrievedProvisionCount}`);
    console.log("");

    console.log("TARGET RETRIEVAL SIGNALS");
    trace.targetRetrievalSignals.forEach((t) =>
      console.log(
        `  [${t.index}] ${t.text} — candidates=${t.candidateCount} bestScore=${t.bestScore?.toFixed(5) ?? "-"} directTargetQueryAdded=${t.directTargetQueryAdded}`,
      ),
    );
    console.log("");

    console.log(`PACKED SOURCES: ${trace.packedSources.length}`);
    trace.packedSources.forEach((source) => {
      const reserved =
        source.reservedForAnswerTargetIndexes.length > 0
          ? ` [RESERVED for target(s) ${source.reservedForAnswerTargetIndexes.join(", ")}]`
          : "";
      console.log(`  ${source.sourceId}: ${source.citationLabel}${reserved}`);
    });
    console.log("");

    console.log(`GENERATION STRUCTURAL FAILURE: ${trace.generationStructuralFailureReason ?? "(none)"}`);
    console.log("");

    console.log("DRAFT CONCLUSIONS (pre-verification)");
    trace.draftConclusions.forEach((c, i) => {
      console.log(`  ${i}. [${c.answerTargetIndex ?? "-"}] ${c.statement}`);
    });
    console.log("");

    console.log("VERIFY (stage 1) RAW RESULTS");
    trace.rawVerifyResults.forEach((r) => console.log(`  #${r.conclusionIndex}: ${r.verdict} — ${r.reason}`));
    console.log(`  verifier structural failure: ${trace.verifierStructuralFailureReason ?? "(none)"}`);
    console.log("");

    console.log("SKEPTIC (stage 2) RAW RESULTS");
    trace.rawSkepticResults.forEach((r) =>
      console.log(`  #${r.conclusionIndex}: hasUnsupportedLeap=${r.hasUnsupportedLeap} — ${r.reason}`),
    );
    console.log(`  skeptic structural failure: ${trace.skepticStructuralFailureReason ?? "(none)"}`);
    console.log("");

    console.log("TARGET COVERAGE (before recovery)");
    trace.targetCoverageBeforeRecovery.forEach((t) => console.log(`  [${t.index}] ${t.status}: ${t.text}`));
    console.log("");

    console.log(`RECOVERY PASS RAN: ${trace.recoveryRan} (mode: ${trace.recoveryMode})`);
    if (trace.recoveryRan) {
      console.log(`  unsupported targets entering recovery: [${trace.unsupportedTargetsEnteringRecovery.join(", ")}]`);
      console.log(`  recovered conclusions: ${trace.recoveredConclusions.length}`);
      trace.recoveredConclusions.forEach((c) =>
        console.log(`    [target ${c.answerTargetIndex ?? "-"}] ${c.statement}`),
      );
    }
    console.log(`  recovery structural failure: ${trace.recoveryStructuralFailureReason ?? "(none)"}`);
    console.log("");

    console.log("TARGET COVERAGE (final, after recovery)");
    trace.targetCoverage.forEach((t) => console.log(`  [${t.index}] ${t.status}: ${t.text}`));
    console.log("");

    console.log("FINAL VERIFIED CONCLUSIONS");
    result.conclusions.forEach((c, i) => {
      const citations = c.support.map((s) => s.citationLabel).join(", ");
      console.log(`  ${i}. [target ${c.answerTargetIndex ?? "-"}] ${c.statement} (${citations})`);
    });

    console.log("");
    console.log("This is a backend diagnostic tool. Not a UI, not a substitute for legal advice.");
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
    console.error(`Legal answer trace failed: ${error.message}`);
  } else {
    console.error("Legal answer trace failed");
  }
  process.exitCode = 1;
});
