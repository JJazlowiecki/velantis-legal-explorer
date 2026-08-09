import { describe, expect, it } from "vitest";

import { classifyRelationType, mapEliReferencesToRelationDrafts } from "./relations";
import type { EliActReferences } from "./schema";

function referenceEntry(publisher: string, year: number, pos: number, title = "Test act") {
  return { act: { publisher, year, pos, title } };
}

describe("classifyRelationType", () => {
  it("maps known ELI Polish labels to stable internal relation types", () => {
    expect(classifyRelationType("Inf. o tekście jednolitym")).toBe("consolidated_text_announcement");
    expect(classifyRelationType("Tekst jednolity dla aktu")).toBe("consolidated_text_for_act");
    expect(classifyRelationType("Nowelizacje po tekście jednolitym")).toBe("post_consolidated_amendment");
    expect(classifyRelationType("Akty zmieniające")).toBe("amending_act");
    expect(classifyRelationType("Orzeczenie TK")).toBe("constitutional_tribunal");
    expect(classifyRelationType("Sprostowanie")).toBe("correction");
  });

  it("falls back to 'unrecognized' for any unknown label rather than crashing", () => {
    expect(classifyRelationType("Akty wykonawcze")).toBe("unrecognized");
    expect(classifyRelationType("Some Future ELI Label Nobody Has Seen Yet")).toBe("unrecognized");
  });
});

describe("mapEliReferencesToRelationDrafts", () => {
  it("flattens a references payload into drafts with a derived relatedSourceId", () => {
    const references: EliActReferences = {
      "Inf. o tekście jednolitym": [referenceEntry("DU", 2026, 795), referenceEntry("DU", 2024, 1061)],
    };

    const drafts = mapEliReferencesToRelationDrafts(references);

    expect(drafts).toContainEqual({
      relationType: "consolidated_text_announcement",
      sourceRelationType: "Inf. o tekście jednolitym",
      relatedSourceId: "DU/2026/795",
    });
    expect(drafts).toContainEqual({
      relationType: "consolidated_text_announcement",
      sourceRelationType: "Inf. o tekście jednolitym",
      relatedSourceId: "DU/2024/1061",
    });
  });

  it("preserves unrecognized labels without crashing, tagging them 'unrecognized'", () => {
    const references: EliActReferences = {
      "Akty wykonawcze": [referenceEntry("DU", 2000, 1)],
    };

    const drafts = mapEliReferencesToRelationDrafts(references);

    expect(drafts).toEqual([
      { relationType: "unrecognized", sourceRelationType: "Akty wykonawcze", relatedSourceId: "DU/2000/1" },
    ]);
  });

  it("deduplicates entries that collapse onto the same (relationType, relatedSourceId) identity", () => {
    const references: EliActReferences = {
      "Akty wykonawcze": [referenceEntry("DU", 2000, 1)],
      "Inne nierozpoznane": [referenceEntry("DU", 2000, 1)],
    };

    // Both unknown labels classify to "unrecognized" and point at the same related act — must
    // collapse to exactly one draft to satisfy the DB's (legalActId, relationType,
    // relatedSourceId) uniqueness, keeping the first-seen source label.
    const drafts = mapEliReferencesToRelationDrafts(references);

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ relationType: "unrecognized", relatedSourceId: "DU/2000/1" });
  });

  it("keeps post-TJ amendment and correction/TK relations distinct and recognized", () => {
    const references: EliActReferences = {
      "Nowelizacje po tekście jednolitym": [referenceEntry("DU", 2026, 902)],
      "Orzeczenie TK": [referenceEntry("DU", 2010, 1)],
      Sprostowanie: [referenceEntry("DU", 2011, 2)],
    };

    const drafts = mapEliReferencesToRelationDrafts(references);
    const types = drafts.map((draft) => draft.relationType).sort();

    expect(types).toEqual(["constitutional_tribunal", "correction", "post_consolidated_amendment"]);
  });
});
