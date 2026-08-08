import { closeScriptDb } from "../db/script-db";
import { EliClientError } from "../lib/legal/eli/client";
import { CliValidationError, ingestEliActMetadata, parseIngestCliArgs } from "../lib/legal/eli/ingest";

function printUsage() {
  console.error("Usage: pnpm ingest:eli --publisher DU --year 1964 --position 93");
}

async function main() {
  const args = parseIngestCliArgs(process.argv.slice(2));
  const result = await ingestEliActMetadata(args);

  console.log("ELI ingest completed");
  console.log(result.sourceId);
  console.log(result.title);
  console.log(`act: ${result.actAction}`);
  console.log(
    `versions: inserted=${result.versions.inserted} updated=${result.versions.updated} unchanged=${result.versions.unchanged}`,
  );
  console.log(
    `resources: inserted=${result.resources.inserted} updated=${result.resources.updated} unchanged=${result.resources.unchanged}`,
  );
  console.log(
    `resource_state: resolved=${result.resources.resolvedCount} unresolved=${result.resources.unresolvedCount}`,
  );
  console.log(
    `source_selection: retrieval=${result.sourceSelection.retrievalVersion ?? "none"} authoritative=${result.sourceSelection.authoritativeVersion ?? "none"}`,
  );

  console.log(`retrieval_reason: ${result.sourceSelection.retrievalReason}`);
  console.log(`authority_reason: ${result.sourceSelection.authorityReason}`);

  if (result.sourceSelection.warnings.length > 0) {
    console.log("warnings:");
    for (const warning of result.sourceSelection.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

main()
  .catch((error: unknown) => {
    if (error instanceof CliValidationError) {
      printUsage();
      console.error(`Argument error: ${error.message}`);
      process.exitCode = 1;
      return;
    }

    if (error instanceof EliClientError) {
      console.error(`ELI request failed: ${error.message}`);
      process.exitCode = 1;
      return;
    }

    if (error instanceof Error) {
      console.error(`ELI ingest failed: ${error.message}`);
    } else {
      console.error("ELI ingest failed");
    }
    process.exitCode = 1;
  })
  .finally(() => closeScriptDb());
