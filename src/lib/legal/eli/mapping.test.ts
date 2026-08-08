import { describe, expect, it } from "vitest";

import ambiguousFixture from "./__fixtures__/ambiguous-text-types.json";
import fixture from "./__fixtures__/du-1964-93.json";
import {
  buildVersionAndResourceDrafts,
  mapEliMetadataToLegalAct,
  mapEliMetadataToRawResources,
} from "./ingest";

describe("ELI metadata mapping", () => {
  it("maps legal act fields conservatively", () => {
    const mapped = mapEliMetadataToLegalAct(fixture);

    expect(mapped.source).toBe("sejm_eli");
    expect(mapped.sourceId).toBe("DU/1964/93");
    expect(mapped.jurisdiction).toBe("PL");
    expect(mapped.title).toContain("Kodeks cywilny");
    expect(mapped.inForce).toBe(true);
    expect(mapped.officialPageUrl).toBe("https://api.sejm.gov.pl/eli/acts/DU/1964/93");
  });

  it("keeps raw resources separate from legal expression semantics", () => {
    const resources = mapEliMetadataToRawResources(fixture);

    expect(resources).toHaveLength(3);

    const duplicatedPdfResource = resources.find((entry) => entry.fileName === "D19640093.pdf");
    expect(duplicatedPdfResource?.representationType).toBe("pdf");
    expect(duplicatedPdfResource?.sourceTypeCodes).toBe("I,O");
  });

  it("builds official expression drafts without using undocumented type codes", () => {
    const bundle = buildVersionAndResourceDrafts(fixture, [
      {
        sourceExpressionId: "ogl",
        canonicalEliUri: "https://eli.gov.pl/eli/DU/1964/93/ogl",
        versionKind: "promulgated",
        evidence: "fixture",
      },
      {
        sourceExpressionId: "tj",
        canonicalEliUri: "https://eli.gov.pl/eli/DU/1964/93/tj",
        versionKind: "consolidated",
        evidence: "fixture",
      },
      {
        sourceExpressionId: "uj",
        canonicalEliUri: "https://eli.gov.pl/eli/DU/1964/93/uj",
        versionKind: "unified",
        evidence: "fixture",
      },
    ]);

    const official = bundle.versions;
    expect(official).toHaveLength(3);
    expect(official.find((entry) => entry.version.sourceExpressionId === "ogl")?.version.versionKind).toBe(
      "promulgated",
    );
    expect(official.find((entry) => entry.version.sourceExpressionId === "tj")?.version.versionKind).toBe(
      "consolidated",
    );
    expect(official.find((entry) => entry.version.sourceExpressionId === "uj")?.version.versionKind).toBe(
      "unified",
    );
    expect(bundle.selection.retrievalVersion?.sourceExpressionId).toBe("uj");
    expect(bundle.selection.authoritativeVersion?.sourceExpressionId).toBe("tj");
  });

  it("does not create fake legal versions for unresolved raw resources", () => {
    const bundle = buildVersionAndResourceDrafts(ambiguousFixture, []);

    expect(bundle.versions).toHaveLength(0);
    expect(bundle.unresolvedActResources.length).toBeGreaterThan(0);
  });

  it("does not claim currentness from reachability alone", () => {
    const bundle = buildVersionAndResourceDrafts(fixture, [
      {
        sourceExpressionId: "uj",
        canonicalEliUri: "https://eli.gov.pl/eli/DU/1964/93/uj",
        versionKind: "unified",
        evidence: "fixture",
      },
    ]);

    expect(bundle.versions[0].version.currentnessStatus).toBe("unproven");
    expect(bundle.versions[0].version.isCurrent).toBe(false);
  });

  it("does not promote undocumented source type codes to legal version kinds", () => {
    const bundle = buildVersionAndResourceDrafts(ambiguousFixture, []);

    expect(bundle.versions.some((entry) => entry.version.versionKind === "unified")).toBe(false);
    expect(bundle.versions.some((entry) => entry.version.versionKind === "consolidated")).toBe(false);
    expect(bundle.versions.some((entry) => entry.version.versionKind === "promulgated")).toBe(false);
  });
});
