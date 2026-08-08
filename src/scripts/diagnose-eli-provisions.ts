import { fetchEliActMetadata, fetchEliActStruct, fetchEliActTextHtml } from "../lib/legal/eli/client";
import {
  extractProvisionDraftsFromStructure,
  ProvisionExtractionError,
} from "../lib/legal/eli/provisions";
import { parseIngestProvisionsCliArgs, ProvisionIngestError } from "../lib/legal/eli/ingest-provisions";
import { normalizeStructTree } from "../lib/legal/eli/structure";

async function main() {
  const args = parseIngestProvisionsCliArgs(process.argv.slice(2));

  const metadata = await fetchEliActMetadata({
    publisher: args.publisher,
    year: args.year,
    position: args.position,
  });

  console.log("ELI provisions diagnostic");
  console.log(`publication: ${metadata.publisher}/${metadata.year}/${metadata.pos}`);
  console.log(`title: ${metadata.title}`);
  console.log(`type: ${metadata.type ?? "unknown"}`);
  console.log(`textHTML: ${metadata.textHTML ?? false}`);
  console.log("metadata_status: available");

  let normalizedRoots = [] as ReturnType<typeof normalizeStructTree>;

  try {
    const structResponse = await fetchEliActStruct({
      publisher: args.publisher,
      year: args.year,
      position: args.position,
    });

    normalizedRoots = normalizeStructTree(structResponse);
  } catch (error) {
    console.log("result: STRUCT_UNAVAILABLE");
    console.log("struct_status: unavailable");
    console.log(`struct_error: ${error instanceof Error ? error.message : "unknown"}`);
    console.log("structured_ingest_possible: false");
    console.log("provisions_persisted: 0");
    return;
  }

  console.log(`root_structure_nodes: ${normalizedRoots.length}`);
  console.log(
    `root_node_types: ${normalizedRoots.map((node) => `${node.kind}:${node.sourceType}`).join(",")}`,
  );

  const attachmentNodes = normalizedRoots.filter((node) => node.isAttachmentBoundary);
  console.log(`attachment_boundary_in_roots: ${attachmentNodes.length > 0}`);

  let htmlDocument = "";
  try {
    htmlDocument = await fetchEliActTextHtml({
      publisher: args.publisher,
      year: args.year,
      position: args.position,
    });
  } catch (error) {
    console.log(`html_error: ${error instanceof Error ? error.message : "unknown"}`);
    return;
  }

  if (htmlDocument.trim().length === 0) {
    console.log("html_status: empty");
    return;
  }

  const extraction = await extractProvisionDraftsFromStructure(normalizedRoots, {
    htmlDocument,
  }).catch((error: unknown) => {
    if (error instanceof ProvisionExtractionError) {
      console.log(`extraction_error: ${error.message}`);
      return null;
    }

    throw error;
  });

  if (!extraction) {
    return;
  }

  console.log(`systematic_nodes: ${extraction.stats.systematicNodes}`);
  console.log(`operative_provisions: ${extraction.stats.operativeProvisions}`);
  console.log(`articles: ${extraction.stats.articleCount}`);
  console.log(`attachment_nodes: ${extraction.stats.attachmentBoundaryCount}`);
  console.log(`source_version_hint: ${args.sourceExpressionId ?? "(not provided)"}`);

  const examples = ["art. 1", "art. 5", "art. 471"];

  for (const example of examples) {
    const hit = extraction.provisions.find((provision) =>
      provision.citationLabel.toLowerCase().startsWith(example.toLowerCase()),
    );

    if (!hit) {
      console.log(`example_${example.replace(/[^a-z0-9]/gi, "_").toLowerCase()}: not found`);
      continue;
    }

    console.log(
      `example_${example.replace(/[^a-z0-9]/gi, "_").toLowerCase()}: ${hit.citationLabel} [${hit.structuralPath}]`,
    );
  }
}

main().catch((error: unknown) => {
  if (error instanceof ProvisionIngestError) {
    console.error(`Diagnostic input error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (error instanceof Error) {
    console.error(`ELI provision diagnostic failed: ${error.message}`);
  } else {
    console.error("ELI provision diagnostic failed");
  }

  process.exitCode = 1;
});
