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
}

main().catch((error: unknown) => {
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
});
