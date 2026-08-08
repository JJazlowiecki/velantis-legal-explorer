import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../db/schema";
import { EmbeddingError } from "../lib/legal/search/embeddings";
import { indexLegalSearchDocuments, SearchIndexingError } from "../lib/legal/search/indexing";
import { parseServerEnv } from "../lib/env/schema";

class CliArgsError extends Error {}

function printUsage() {
  console.error("Usage: pnpm index:legal-search --version-id <UUID>");
}

function parseArgs(argv: string[]): { versionId: string } {
  let versionId: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--version-id") {
      versionId = argv[i + 1];
      i += 1;
      continue;
    }
    throw new CliArgsError(`Unexpected argument: ${current}`);
  }

  if (!versionId) {
    throw new CliArgsError("--version-id is required");
  }

  return { versionId };
}

async function main() {
  loadEnv({ path: ".env" });
  const env = parseServerEnv(process.env);
  const client = postgres(env.DATABASE_URL, { max: 1 });
  const db = drizzle({ client, schema });

  try {
    const { versionId } = parseArgs(process.argv.slice(2));

    const result = await indexLegalSearchDocuments(versionId, {
      db,
      onProgress: (message) => console.log(message),
    });

    console.log("Search indexing completed");
    console.log(`version: ${result.legalActVersionId}`);
    console.log(`provisions considered: ${result.provisionsConsidered}`);
    console.log(`search documents: ${result.searchDocuments}`);
    console.log(`embedded: ${result.embedded}`);
    console.log(`unchanged: ${result.unchanged}`);
    console.log(`removed: ${result.removed}`);
    console.log(`model: ${result.model}`);
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

  if (error instanceof SearchIndexingError) {
    console.error(`Search indexing error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (error instanceof EmbeddingError) {
    console.error(`Embedding error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (error instanceof Error) {
    console.error(`Search indexing failed: ${error.message}`);
  } else {
    console.error("Search indexing failed");
  }
  process.exitCode = 1;
});
