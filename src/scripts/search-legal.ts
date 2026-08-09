import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../db/schema";
import { parseServerEnv } from "../lib/env/schema";
import { EmbeddingError } from "../lib/legal/search/embeddings";
import { HybridSearchError, hybridLegalSearch } from "../lib/legal/search/service";

class CliArgsError extends Error {}

function printUsage() {
  console.error(
    'Usage: pnpm search:legal --version-id <UUID> [--version-id <UUID> ...] --query "odpowiedzialność za niewykonanie umowy"',
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

    const result = await hybridLegalSearch({
      query,
      legalActVersionIds: versionIds,
      db,
    });

    console.log(`Legal search diagnostic: "${result.query}"`);
    console.log(`corpus: ${result.legalActVersionIds.join(", ")}`);
    if (result.vectorSearchSkippedReason) {
      console.log(`vector_search: skipped (${result.vectorSearchSkippedReason})`);
    }
    console.log(
      `timings_ms: lexical=${result.timingsMs.lexical} vector=${result.timingsMs.vector} total=${result.timingsMs.total}`,
    );
    console.log("");

    if (result.results.length === 0) {
      console.log("No results.");
      return;
    }

    result.results.forEach((item, index) => {
      console.log(
        `${index + 1}. ${item.actTitle} — ${item.citationLabel}${item.isExactCitationMatch ? " [EXACT CITATION]" : ""}`,
      );
      if (item.hierarchy.length > 0) {
        console.log(`   ${item.hierarchy.join(" / ")}`);
      }
      console.log(`   ${item.text.slice(0, 200)}${item.text.length > 200 ? "..." : ""}`);
      console.log(
        `   version_kind: ${item.versionKind} authority_class: ${item.authorityClass} currentness_status: ${item.currentnessStatus} source_expression_id: ${item.sourceExpressionId}`,
      );
      console.log(
        `   lexical rank: ${item.lexicalRank ?? "-"} | vector rank: ${item.vectorRank ?? "-"} | vector similarity: ${item.vectorSimilarity !== null ? item.vectorSimilarity.toFixed(4) : "-"} | hybrid score: ${item.finalScore.toFixed(4)}`,
      );
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

  if (error instanceof HybridSearchError) {
    console.error(`Search error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (error instanceof EmbeddingError) {
    console.error(`Embedding error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (error instanceof Error) {
    console.error(`Legal search failed: ${error.message}`);
  } else {
    console.error("Legal search failed");
  }
  process.exitCode = 1;
});
