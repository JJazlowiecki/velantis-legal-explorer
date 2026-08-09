import { describe, expect, it } from "vitest";

import { validateEvidenceAgainstSources } from "./evidence";

const sourceTextById = new Map([
  ["SOURCE_1", "Art. 471. Dłużnik obowiązany jest do naprawienia szkody\nwynikłej z niewykonania zobowiązania."],
]);

describe("validateEvidenceAgainstSources", () => {
  it("accepts an excerpt that occurs verbatim in the source text", () => {
    const failures = validateEvidenceAgainstSources(
      [{ sourceId: "SOURCE_1", excerpt: "Dłużnik obowiązany jest do naprawienia szkody" }],
      sourceTextById,
    );
    expect(failures).toEqual([]);
  });

  it("normalizes whitespace/newlines only (no fuzzy matching) when checking occurrence", () => {
    const failures = validateEvidenceAgainstSources(
      [{ sourceId: "SOURCE_1", excerpt: "naprawienia szkody\n   wynikłej z niewykonania" }],
      sourceTextById,
    );
    expect(failures).toEqual([]);
  });

  it("rejects an excerpt that does not occur in the source (invented/paraphrased text)", () => {
    const failures = validateEvidenceAgainstSources(
      [{ sourceId: "SOURCE_1", excerpt: "Sąsiad odpowiada za wycięcie drzewa bez zgody." }],
      sourceTextById,
    );
    expect(failures).toEqual([{ sourceId: "SOURCE_1", excerpt: "Sąsiad odpowiada za wycięcie drzewa bez zgody.", reason: "excerpt_not_found" }]);
  });

  it("rejects a paraphrase that changes wording even if meaning is similar", () => {
    const failures = validateEvidenceAgainstSources(
      [{ sourceId: "SOURCE_1", excerpt: "Dłużnik musi naprawić wyrządzoną szkodę" }],
      sourceTextById,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toBe("excerpt_not_found");
  });

  it("rejects an evidence entry referencing an unknown sourceId", () => {
    const failures = validateEvidenceAgainstSources(
      [{ sourceId: "SOURCE_99", excerpt: "cokolwiek" }],
      sourceTextById,
    );
    expect(failures).toEqual([{ sourceId: "SOURCE_99", excerpt: "cokolwiek", reason: "unknown_source" }]);
  });

  it("validates multiple evidence entries independently and reports every failure", () => {
    const failures = validateEvidenceAgainstSources(
      [
        { sourceId: "SOURCE_1", excerpt: "Dłużnik obowiązany jest do naprawienia szkody" },
        { sourceId: "SOURCE_1", excerpt: "wymyślony fragment" },
      ],
      sourceTextById,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].excerpt).toBe("wymyślony fragment");
  });

  it("returns no failures for an empty evidence list", () => {
    expect(validateEvidenceAgainstSources([], sourceTextById)).toEqual([]);
  });
});
