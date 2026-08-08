import { fetchEliActMetadata } from "../lib/legal/eli/client";
import { discoverOfficialExpressions } from "../lib/legal/eli/expressions";
import { buildVersionAndResourceDrafts, parseIngestCliArgs } from "../lib/legal/eli/ingest";

async function main() {
  const args = parseIngestCliArgs(process.argv.slice(2));

  const metadata = await fetchEliActMetadata({
    publisher: args.publisher,
    year: args.year,
    position: args.position,
  });

  const discovered = await discoverOfficialExpressions(metadata);
  const draftBundle = buildVersionAndResourceDrafts(metadata, discovered);
  const drafts = draftBundle.versions;
  const selection = draftBundle.selection;

  console.log("Civil Code source resolution");
  console.log(`act: ${metadata.publisher}/${metadata.year}/${metadata.pos}`);

  const officialKinds: Array<{ label: string; kind: "promulgated" | "consolidated" | "unified" }> = [
    { label: "promulgated", kind: "promulgated" },
    { label: "consolidated", kind: "consolidated" },
    { label: "unified", kind: "unified" },
  ];

  for (const item of officialKinds) {
    const match = drafts.find((entry) => entry.version.versionKind === item.kind);
    console.log(`${item.label}:`);
    if (!match) {
      console.log("  not discovered");
      continue;
    }

    console.log(`  expression_id: ${match.version.sourceExpressionId}`);
    console.log(`  canonical_eli_uri: ${match.version.canonicalEliUri ?? "n/a"}`);
    if (match.resources.length > 0) {
      for (const resource of match.resources) {
        console.log(`  resource: ${resource.sourceUrl} (${resource.representationType})`);
      }
    }
  }

  if (draftBundle.unresolvedActResources.length > 0) {
    console.log("unresolved_act_resources:");
    for (const resource of draftBundle.unresolvedActResources) {
      console.log(
        `  resource: ${resource.sourceUrl} (${resource.representationType}, raw_types=${resource.sourceTypeCodes})`,
      );
    }
  }

  console.log("retrieval_selection:");
  if (!selection.retrievalVersion) {
    console.log("  none");
  } else {
    console.log(`  expression_id: ${selection.retrievalVersion.sourceExpressionId}`);
    console.log(`  version_kind: ${selection.retrievalVersion.versionKind}`);
    console.log(`  canonical_eli_uri: ${selection.retrievalVersion.canonicalEliUri ?? "n/a"}`);
    console.log(`  non_authoritative: ${selection.retrievalVersion.nonAuthoritative}`);
    console.log(`  authority_class: ${selection.retrievalVersion.authorityClass}`);
    console.log(`  currentness_status: ${selection.retrievalVersion.currentnessStatus}`);
  }

  console.log("authoritative_selection:");
  if (!selection.authoritativeVersion) {
    console.log("  none");
  } else {
    console.log(`  expression_id: ${selection.authoritativeVersion.sourceExpressionId}`);
    console.log(`  version_kind: ${selection.authoritativeVersion.versionKind}`);
    console.log(`  canonical_eli_uri: ${selection.authoritativeVersion.canonicalEliUri ?? "n/a"}`);
    console.log(`  non_authoritative: ${selection.authoritativeVersion.nonAuthoritative}`);
    console.log(`  authority_class: ${selection.authoritativeVersion.authorityClass}`);
    console.log(`  currentness_status: ${selection.authoritativeVersion.currentnessStatus}`);
  }

  console.log(`retrieval_reason: ${selection.retrievalReason}`);
  console.log(`authority_reason: ${selection.authorityReason}`);

  if (selection.warnings.length > 0) {
    console.log("warnings:");
    for (const warning of selection.warnings) {
      console.log(`  - ${warning}`);
    }
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(`ELI source diagnostics failed: ${error.message}`);
  } else {
    console.error("ELI source diagnostics failed");
  }

  process.exitCode = 1;
});
