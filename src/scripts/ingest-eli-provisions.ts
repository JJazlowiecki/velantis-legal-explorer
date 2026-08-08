import { closeScriptDb } from "../db/script-db";
import { EliClientError } from "../lib/legal/eli/client";
import {
  ingestEliProvisions,
  parseIngestProvisionsCliArgs,
  ProvisionIngestError,
} from "../lib/legal/eli/ingest-provisions";

function printUsage() {
  console.error(
    "Usage: pnpm ingest:eli-provisions --publisher DU --year 2026 --position 795 --source-expression-id source_publication --version-kind consolidated",
  );
}

async function main() {
  const args = parseIngestProvisionsCliArgs(process.argv.slice(2));
  const result = await ingestEliProvisions(args, {
    onProgress: (message) => console.log(message),
  });

  console.log("ELI provisions ingest completed");
  console.log(`source_id: ${result.sourceId}`);
  console.log(`legal_act_version_id: ${result.legalActVersionId}`);
  console.log(`legal_act_action: ${result.legalActAction}`);
  console.log(`version_action: ${result.versionAction}`);
  console.log(
    `provisions: inserted=${result.provisions.inserted} updated=${result.provisions.updated} unchanged=${result.provisions.unchanged} deleted=${result.provisions.deleted} total=${result.provisions.total}`,
  );
  console.log(
    `stats: systematic_nodes=${result.stats.systematicNodes} operative_provisions=${result.stats.operativeProvisions} articles=${result.stats.articleCount} attachments=${result.stats.attachmentBoundaryCount}`,
  );
  console.log(
    `timings_ms: metadata=${result.timingsMs.metadataFetch} struct=${result.timingsMs.structFetch} html=${result.timingsMs.htmlFetch} extract=${result.timingsMs.extract} persist=${result.timingsMs.persist} total=${result.timingsMs.total}`,
  );
  console.log(
    `fragment_fallback: used=${result.stats.fallbackUsed} requests=${result.stats.fallbackRequestCount} unique_nodes=${result.stats.fallbackUniqueNodeCount}`,
  );

  if (result.stats.unresolvedNodeTypes.length > 0) {
    console.log(`unresolved_node_types: ${result.stats.unresolvedNodeTypes.join(",")}`);
  }
}

main()
  .catch((error: unknown) => {
    if (error instanceof ProvisionIngestError) {
      printUsage();
      console.error(`Provision ingest error: ${error.message}`);
      process.exitCode = 1;
      return;
    }

    if (error instanceof EliClientError) {
      console.error(`ELI request failed: ${error.message}`);
      process.exitCode = 1;
      return;
    }

    if (error instanceof Error) {
      console.error(`ELI provision ingest failed: ${error.message}`);
    } else {
      console.error("ELI provision ingest failed");
    }

    process.exitCode = 1;
  })
  .finally(() => closeScriptDb());
