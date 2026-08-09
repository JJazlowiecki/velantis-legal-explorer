import { getScriptDb } from "../db/script-db";
import { ELI_SOURCE } from "../lib/legal/eli/schema";
import { DestructiveShrinkError, StructureIngestError, ingestActStructure } from "../lib/legal/eli/structure-ingest";

function printUsage() {
  console.error(
    "Usage: pnpm ingest:eli-structure --publisher DU --year 1964 --position 93 --expression ogl [--allow-destructive-shrink]",
  );
}

interface Args {
  publisher: string;
  year: string;
  position: string;
  expression: string;
  allowDestructiveShrink: boolean;
}

const BOOLEAN_FLAGS = new Set(["allow-destructive-shrink"]);

function parseArgs(argv: string[]): Args {
  const parsed: Record<string, string> = {};
  const flags = new Set<string>();

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);

    if (BOOLEAN_FLAGS.has(key)) {
      flags.add(key);
      continue;
    }

    const value = argv[i + 1];
    parsed[key] = value;
    i += 1;
  }

  if (!parsed.publisher || !parsed.year || !parsed.position || !parsed.expression) {
    printUsage();
    throw new StructureIngestError("Missing required arguments");
  }

  if (!["ogl", "tj", "uj"].includes(parsed.expression)) {
    throw new StructureIngestError(`--expression must be one of ogl/tj/uj, got "${parsed.expression}"`);
  }

  return {
    publisher: parsed.publisher,
    year: parsed.year,
    position: parsed.position,
    expression: parsed.expression,
    allowDestructiveShrink: flags.has("allow-destructive-shrink"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceId = `${args.publisher}/${args.year}/${args.position}`;
  const textUrl = `https://api.sejm.gov.pl/eli/acts/${args.publisher}/${args.year}/${args.position}/text.html`;

  console.log(`Fetching ${textUrl}`);
  const response = await fetch(textUrl, {
    headers: { "User-Agent": "Velantis-Legal-Explorer/0.1 (+https://velantis.local)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new StructureIngestError(`Failed to fetch act text: HTTP ${response.status}`);
  }
  const html = await response.text();

  const db = getScriptDb();
  const result = await ingestActStructure({
    db,
    source: ELI_SOURCE,
    sourceId,
    sourceExpressionId: args.expression,
    html,
    allowDestructiveShrink: args.allowDestructiveShrink,
  });

  console.log("Structure ingest completed");
  console.log(`legal_act_id: ${result.legalActId}`);
  console.log(`legal_act_version_id: ${result.legalActVersionId}`);
  console.log(`deleted_existing_provisions: ${result.deletedCount}`);
  console.log(`inserted_provisions: ${result.insertedCount}`);
}

main().catch((error: unknown) => {
  if (error instanceof DestructiveShrinkError) {
    console.error(`Structure ingest refused (destructive-shrink guard): ${error.message}`);
    console.error(`existing_count: ${error.existingCount}`);
    console.error(`parsed_count: ${error.parsedCount}`);
    console.error(`max_drop_ratio: ${error.maxDropRatio}`);
    console.error("Re-run with --allow-destructive-shrink if this shrink is genuinely expected.");
    process.exitCode = 1;
    return;
  }
  if (error instanceof StructureIngestError) {
    console.error(`Structure ingest failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (error instanceof Error) {
    console.error(`Structure ingest failed: ${error.name}: ${error.message}`);
  } else {
    console.error("Structure ingest failed");
  }
  process.exitCode = 1;
});
