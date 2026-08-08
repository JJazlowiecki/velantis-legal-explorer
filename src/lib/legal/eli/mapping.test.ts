import { describe, expect, it } from "vitest";

import fixture from "./__fixtures__/du-1964-93.json";
import {
  mapEliMetadataToLegalAct,
  mapEliMetadataToLegalActResources,
  mapEliMetadataToLegalActVersion,
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

  it("maps a single conservative legal version without guessing semantics", () => {
    const version = mapEliMetadataToLegalActVersion(fixture);

    expect(version.versionKind).toBe("unknown");
    expect(version.isCurrent).toBe(false);
    expect(version.sourceDocumentKey).toBe("SEJM_ELI:UNKNOWN_VERSION");
  });

  it("maps and deduplicates text resources by source URL", () => {
    const resources = mapEliMetadataToLegalActResources(fixture);

    expect(resources).toHaveLength(3);

    const htmlResource = resources.find((entry) => entry.fileName === "text.html");
    expect(htmlResource?.representationType).toBe("html");

    const duplicatedPdfResource = resources.find((entry) => entry.fileName === "D19640093.pdf");
    expect(duplicatedPdfResource?.representationType).toBe("pdf");
    expect(duplicatedPdfResource?.sourceTypeCodes).toBe("I,O");

    const unifiedPdfResource = resources.find((entry) => entry.fileName === "D19640093Lj.pdf");
    expect(unifiedPdfResource?.representationType).toBe("pdf");
    expect(unifiedPdfResource?.sourceTypeCodes).toBe("U");
  });
});
