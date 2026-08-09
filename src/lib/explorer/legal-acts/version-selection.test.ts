import { describe, expect, it } from "vitest";

import { chooseDisplayVersion, type VersionSelectionInput } from "./version-selection";

function version(overrides: Partial<VersionSelectionInput> & Pick<VersionSelectionInput, "id" | "sourceExpressionId" | "versionKind">): VersionSelectionInput {
  return {
    canonicalEliUri: null,
    authorityClass: "authoritative",
    nonAuthoritative: false,
    currentnessStatus: "unproven",
    fetchedAt: new Date("2026-01-01T00:00:00Z"),
    hasStructure: false,
    ...overrides,
  };
}

describe("chooseDisplayVersion", () => {
  it("returns all-null for an act with zero versions", () => {
    const result = chooseDisplayVersion([]);
    expect(result).toEqual({ defaultVersionId: null, authoritativeVersionId: null, retrievalVersionId: null, warnings: [] });
  });

  it("picks the single structured version as default when only one version exists", () => {
    const v = version({ id: "v1", sourceExpressionId: "ogl", versionKind: "promulgated", hasStructure: true });
    const result = chooseDisplayVersion([v]);
    expect(result.defaultVersionId).toBe("v1");
    expect(result.authoritativeVersionId).toBe("v1");
  });

  it("real Civil Code case: ogl/tj/uj all present but NONE structured falls back to the authoritative (tj) version for metadata display, with an honest no-structure warning", () => {
    const ogl = version({ id: "ogl", sourceExpressionId: "ogl", versionKind: "promulgated", authorityClass: "authoritative" });
    const tj = version({ id: "tj", sourceExpressionId: "tj", versionKind: "consolidated", authorityClass: "authoritative" });
    const uj = version({ id: "uj", sourceExpressionId: "uj", versionKind: "unified", authorityClass: "non_authoritative", nonAuthoritative: true });

    const result = chooseDisplayVersion([ogl, tj, uj]);

    expect(result.authoritativeVersionId).toBe("tj");
    expect(result.defaultVersionId).toBe("tj");
    expect(result.warnings).toContain("Brak dostępnej struktury aktu dla żadnej znanej wersji.");
    // UJ is never silently treated as authoritative even though it's the retrieval preference.
    expect(result.retrievalVersionId).toBe("uj");
    expect(result.warnings.some((w) => w.toLowerCase().includes("non-authoritative"))).toBe(true);
  });

  it("prefers a structured authoritative consolidated version over an unstructured one of the same act", () => {
    const tj = version({ id: "tj", sourceExpressionId: "tj", versionKind: "consolidated", hasStructure: true });
    const ogl = version({ id: "ogl", sourceExpressionId: "ogl", versionKind: "promulgated", hasStructure: false });

    const result = chooseDisplayVersion([tj, ogl]);
    expect(result.defaultVersionId).toBe("tj");
    expect(result.warnings).not.toContain("Brak dostępnej struktury aktu dla żadnej znanej wersji.");
  });

  it("falls back to a structured UJ when it is the only version with structure, but still warns it is non-authoritative", () => {
    const ogl = version({ id: "ogl", sourceExpressionId: "ogl", versionKind: "promulgated", hasStructure: false });
    const uj = version({ id: "uj", sourceExpressionId: "uj", versionKind: "unified", authorityClass: "non_authoritative", nonAuthoritative: true, hasStructure: true });

    const result = chooseDisplayVersion([ogl, uj]);

    expect(result.defaultVersionId).toBe("uj");
    expect(result.authoritativeVersionId).toBe("ogl");
    expect(result.warnings.some((w) => w.includes("wyświetlono inną dostępną wersję ze strukturą"))).toBe(true);
    expect(result.warnings.some((w) => w.toLowerCase().includes("non-authoritative"))).toBe(true);
  });

  it("real KPA case: two versions share versionKind='promulgated' (a legacy duplicate) — deterministically prefers the structured, officially-named one", () => {
    const legacyPerf = version({
      id: "perf",
      sourceExpressionId: "source_1960_168_perf",
      versionKind: "promulgated",
      hasStructure: true,
      fetchedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const officialOgl = version({
      id: "ogl",
      sourceExpressionId: "ogl",
      versionKind: "promulgated",
      hasStructure: true,
      fetchedAt: new Date("2026-01-02T00:00:00Z"),
    });

    const result = chooseDisplayVersion([legacyPerf, officialOgl]);

    // Both have structure, so the tie-break prefers the officially-recognized expression id.
    expect(result.defaultVersionId).toBe("ogl");
  });

  it("never claims proven currentness that was not supplied", () => {
    const v = version({ id: "v1", sourceExpressionId: "tj", versionKind: "consolidated", hasStructure: true, currentnessStatus: "unproven" });
    const result = chooseDisplayVersion([v]);
    expect(result.warnings.some((w) => w.toLowerCase().includes("currentness is unproven"))).toBe(true);
  });
});
