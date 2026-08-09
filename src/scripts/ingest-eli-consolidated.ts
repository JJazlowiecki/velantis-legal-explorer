import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../db/schema";
import { ConsolidatedIngestError, ingestOfficialConsolidatedStructure } from "../lib/legal/eli/consolidated-ingest";
import { EliClientError } from "../lib/legal/eli/client";
import { AnnexSelectionError } from "../lib/legal/eli/structure";
import { DestructiveShrinkError } from "../lib/legal/eli/structure-ingest";
import { parseServerEnv } from "../lib/env/schema";

function printUsage() {
  console.error(
    "Usage: pnpm ingest:eli-consolidated --base DU/1964/93 --announcement DU/2024/1061 [--allow-destructive-shrink]",
  );
}

interface Args {
  base: string;
  announcement: string;
  allowDestructiveShrink: boolean;
}

function parseArgs(argv: string[]): Args {
  const parsed: Record<string, string> = {};
  const flags = new Set<string>();

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);

    if (key === "allow-destructive-shrink") {
      flags.add(key);
      continue;
    }

    const value = argv[i + 1];
    parsed[key] = value;
    i += 1;
  }

  if (!parsed.base || !parsed.announcement) {
    printUsage();
    throw new ConsolidatedIngestError("Missing required arguments");
  }

  return {
    base: parsed.base,
    announcement: parsed.announcement,
    allowDestructiveShrink: flags.has("allow-destructive-shrink"),
  };
}

async function main() {
  loadEnv({ path: ".env" });
  const env = parseServerEnv(process.env);
  const client = postgres(env.DATABASE_URL, { max: 1 });
  const db = drizzle({ client, schema });

  try {
    const args = parseArgs(process.argv.slice(2));

    const result = await ingestOfficialConsolidatedStructure({
      db,
      baseActSourceId: args.base,
      announcementActSourceId: args.announcement,
      allowDestructiveShrink: args.allowDestructiveShrink,
    });

    console.log("Consolidated structure ingest completed");
    console.log(`base_legal_act_id: ${result.baseLegalActId}`);
    console.log(`announcement_legal_act_id: ${result.announcementLegalActId}`);
    console.log(`legal_act_version_id: ${result.legalActVersionId}`);
    console.log(`version_action: ${result.versionAction}`);
    console.log(`deleted_existing_provisions: ${result.deletedCount}`);
    console.log(`inserted_provisions: ${result.insertedCount}`);
  } finally {
    await client.end({ timeout: 1 });
  }
}

main().catch((error: unknown) => {
  if (error instanceof DestructiveShrinkError) {
    console.error(`Consolidated ingest refused (destructive-shrink guard): ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (error instanceof AnnexSelectionError) {
    console.error(`Consolidated ingest refused (annex selection): ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (error instanceof EliClientError) {
    console.error(`ELI request failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (error instanceof ConsolidatedIngestError) {
    console.error(`Consolidated ingest failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (error instanceof Error) {
    console.error(`Consolidated ingest failed: ${error.name}: ${error.message}`);
  } else {
    console.error("Consolidated ingest failed");
  }
  process.exitCode = 1;
});
