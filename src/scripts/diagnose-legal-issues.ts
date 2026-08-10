import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../db/schema";
import { parseServerEnv } from "../lib/env/schema";
import { IssueDetectionError } from "../lib/legal/issues/detect";
import { investigateLegalProblem, LegalIssueInvestigationError } from "../lib/legal/issues/investigate";

class CliArgsError extends Error {}

function printUsage() {
  console.error(
    'Usage: pnpm diagnose:legal-issues --version-id <UUID> [--version-id <UUID> ...] --query "firma remontowa źle zrobiła remont..."',
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

async function main() {
  loadEnv({ path: ".env" });
  const env = parseServerEnv(process.env);
  const client = postgres(env.DATABASE_URL, { max: 1 });
  const db = drizzle({ client, schema });

  try {
    const { versionIds, query } = parseArgs(process.argv.slice(2));

    const result = await investigateLegalProblem({
      problemDescription: query,
      legalActVersionIds: versionIds,
      db,
    });

    console.log("USER PROBLEM");
    console.log(result.problemDescription);
    console.log("");
    console.log(`SUMMARY: ${result.summary}`);
    console.log(
      `ANSWER TARGETS: ${result.answerTargets.length === 0 ? "(none)" : result.answerTargets.map((t) => `[${t.index}] ${t.text}`).join(" | ")}`,
    );
    if (result.clarificationQuestion) {
      console.log(`CLARIFICATION NEEDED: ${result.clarificationQuestion}`);
    }
    console.log("");
    console.log("This is retrieval diagnostics only. Not legal advice, not a final answer.");
    console.log("");

    const provisionsById = new Map(result.retrievedProvisions.map((item) => [item.legalProvisionId, item]));

    result.issues.forEach((issue, index) => {
      console.log(`ISSUE ${index + 1}: ${issue.label}`);
      console.log(`likelihood: ${issue.likelihood}`);
      console.log(`rationale: ${issue.rationale}`);
      console.log(
        `retrieval queries: ${issue.retrievalQueries.map((q) => `${q.query} (target ${q.answerTargetIndex})`).join(" | ")}`,
      );

      if (issue.retrievedProvisionIds.length === 0) {
        console.log("retrieved provisions: none (hypothesis unsupported by retrieval in this corpus)");
      } else {
        console.log("retrieved provisions:");
        issue.retrievedProvisionIds.forEach((provisionId) => {
          const provision = provisionsById.get(provisionId);
          if (!provision) return;
          console.log(
            `  - ${provision.actTitle} — ${provision.citationLabel} [${provision.authorityClass}/${provision.currentnessStatus}]`,
          );
          console.log(`    ${provision.text.slice(0, 160)}${provision.text.length > 160 ? "..." : ""}`);
        });
      }
      console.log("");
    });
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

  if (error instanceof IssueDetectionError) {
    console.error(`Issue detection error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (error instanceof Error) {
    console.error(`Legal issue diagnostic failed: ${error.message}`);
  } else {
    console.error("Legal issue diagnostic failed");
  }
  process.exitCode = 1;
});
