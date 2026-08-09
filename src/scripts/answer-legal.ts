import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../db/schema";
import { parseServerEnv } from "../lib/env/schema";
import { answerLegalProblem, LegalAnswerError } from "../lib/legal/answer/answer";
import { FinalAnswerGenerationError } from "../lib/legal/answer/generate";
import { IssueDetectionError } from "../lib/legal/issues/detect";
import { LegalIssueInvestigationError } from "../lib/legal/issues/investigate";

class CliArgsError extends Error {}

function printUsage() {
  console.error(
    'Usage: pnpm answer:legal --version-id <UUID> [--version-id <UUID> ...] --query "firma remontowa źle zrobiła remont..."',
  );
}

function parseArgs(argv: string[]): { versionIds: string[]; query: string } {
  const versionIds: string[] = [];
  let query: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];

    if (current === "--version-id") {
      const value = argv[i + 1];
      if (!value) {
        throw new CliArgsError("Missing value for --version-id");
      }
      versionIds.push(value);
      i += 1;
      continue;
    }

    if (current === "--query") {
      const value = argv[i + 1];
      if (!value) {
        throw new CliArgsError("Missing value for --query");
      }
      query = value;
      i += 1;
      continue;
    }

    throw new CliArgsError(`Unexpected argument: ${current}`);
  }

  if (versionIds.length === 0) {
    throw new CliArgsError("At least one --version-id is required");
  }

  if (!query) {
    throw new CliArgsError("--query is required");
  }

  return { versionIds, query };
}

function formatSourceLine(source: {
  citationLabel: string;
  actTitle: string;
  versionKind: string;
  authorityClass: string;
  currentnessStatus: string;
  sourceExpressionId: string;
}): string {
  return `${source.actTitle} — ${source.citationLabel} [version_kind=${source.versionKind} authority_class=${source.authorityClass} currentness_status=${source.currentnessStatus} source_expression_id=${source.sourceExpressionId}]`;
}

async function main() {
  loadEnv({ path: ".env" });
  const env = parseServerEnv(process.env);
  const client = postgres(env.DATABASE_URL, { max: 1 });
  const db = drizzle({ client, schema });

  try {
    const { versionIds, query } = parseArgs(process.argv.slice(2));

    console.log("USER PROBLEM");
    console.log(query);
    console.log("");

    const result = await answerLegalProblem({
      problemDescription: query,
      legalActVersionIds: versionIds,
      db,
    });

    console.log(`STATUS: ${result.status}`);
    console.log("");

    console.log("FINAL ANSWER");
    console.log(result.answer);
    console.log("");

    console.log("SUPPORTED CONCLUSIONS");
    if (result.conclusions.length === 0) {
      console.log("(none)");
    } else {
      result.conclusions.forEach((conclusion, index) => {
        console.log(`${index + 1}. ${conclusion.statement}`);
        conclusion.support.forEach((source) => console.log(`   - ${formatSourceLine(source)}`));
      });
    }
    console.log("");

    if (result.alternativePaths.length > 0) {
      console.log("ALTERNATIVE / UNSUPPORTED PATHS (includes hypotheses and draft conclusions that failed claim-to-source verification)");
      result.alternativePaths.forEach((path) => {
        console.log(`- ${path.issueLabel}: ${path.explanation}`);
        if (path.support.length === 0) {
          console.log("   (no supporting source in this corpus)");
        } else {
          path.support.forEach((source) => console.log(`   - ${formatSourceLine(source)}`));
        }
      });
      console.log("");
    }

    console.log("SOURCES");
    if (result.sources.length === 0) {
      console.log("(none)");
    } else {
      result.sources.forEach((source) => console.log(`- ${formatSourceLine(source)}`));
    }
    console.log("");

    console.log("UNCERTAINTIES");
    if (result.uncertainties.length === 0) {
      console.log("(none)");
    } else {
      result.uncertainties.forEach((item) => console.log(`- ${item}`));
    }
    console.log("");

    if (result.clarificationQuestion) {
      console.log(`CLARIFICATION NEEDED: ${result.clarificationQuestion}`);
      console.log("");
    }

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

  if (error instanceof LegalIssueInvestigationError) {
    console.error(`Investigation error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (error instanceof LegalAnswerError) {
    console.error(`Answer generation error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (error instanceof IssueDetectionError) {
    console.error(`Issue detection error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (error instanceof FinalAnswerGenerationError) {
    console.error(`Final answer error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (error instanceof Error) {
    console.error(`Legal answer diagnostic failed: ${error.message}`);
  } else {
    console.error("Legal answer diagnostic failed");
  }
  process.exitCode = 1;
});
