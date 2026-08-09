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
    sourceAnnouncementLegalActId: null,
    legalStateDate: null,
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

  describe("multiple immutable announcement-backed TJ versions (real current-law-corpus scenario)", () => {
    it("real KC case: legacy tj alias plus two announcement-backed tj versions — never arbitrarily picks the legacy alias, deterministically prefers the structured, most-recent-legalStateDate real version", () => {
      const ogl = version({ id: "ogl", sourceExpressionId: "ogl", versionKind: "promulgated", hasStructure: true });
      const legacyAlias = version({
        id: "legacy-tj",
        sourceExpressionId: "tj",
        versionKind: "consolidated",
        hasStructure: false,
        sourceAnnouncementLegalActId: null,
        fetchedAt: new Date("2020-01-01T00:00:00Z"), // earliest — would win under the OLD fetchedAt-based tie-break
      });
      const olderReal = version({
        id: "tj-2023-1610",
        sourceExpressionId: "tj",
        versionKind: "consolidated",
        hasStructure: true,
        sourceAnnouncementLegalActId: "announcement-2023-1610",
        legalStateDate: "2023-07-28",
      });
      const newerReal = version({
        id: "tj-2024-1061",
        sourceExpressionId: "tj",
        versionKind: "consolidated",
        hasStructure: true,
        sourceAnnouncementLegalActId: "announcement-2024-1061",
        legalStateDate: "2024-06-19",
      });

      const result = chooseDisplayVersion([ogl, legacyAlias, olderReal, newerReal]);

      expect(result.defaultVersionId).toBe("tj-2024-1061");
      expect(result.authoritativeVersionId).toBe("tj-2024-1061");
      expect(result.warnings.some((w) => w.includes("2 niezależne"))).toBe(true);
      expect(result.defaultVersionId).not.toBe("legacy-tj");
    });

    it("falls back to the legacy alias ONLY when no real announcement-backed version exists at all", () => {
      const legacyAlias = version({
        id: "legacy-tj",
        sourceExpressionId: "tj",
        versionKind: "consolidated",
        hasStructure: false,
        sourceAnnouncementLegalActId: null,
      });

      const result = chooseDisplayVersion([legacyAlias]);

      expect(result.authoritativeVersionId).toBe("legacy-tj");
    });

    it("among real versions with no structure at all, still picks the one with the most recent legalStateDate deterministically", () => {
      const olderReal = version({
        id: "tj-old",
        sourceExpressionId: "tj",
        versionKind: "consolidated",
        hasStructure: false,
        sourceAnnouncementLegalActId: "announcement-old",
        legalStateDate: "2023-01-01",
      });
      const newerRealNoStructure = version({
        id: "tj-new-no-structure",
        sourceExpressionId: "tj",
        versionKind: "consolidated",
        hasStructure: false,
        sourceAnnouncementLegalActId: "announcement-new",
        legalStateDate: "2026-05-19",
      });

      const result = chooseDisplayVersion([olderReal, newerRealNoStructure]);

      expect(result.authoritativeVersionId).toBe("tj-new-no-structure");
    });

    it("does not warn about multiple versions when only one real announcement-backed TJ exists alongside the legacy alias", () => {
      const legacyAlias = version({
        id: "legacy-tj",
        sourceExpressionId: "tj",
        versionKind: "consolidated",
        sourceAnnouncementLegalActId: null,
      });
      const onlyReal = version({
        id: "tj-real",
        sourceExpressionId: "tj",
        versionKind: "consolidated",
        hasStructure: true,
        sourceAnnouncementLegalActId: "announcement-1",
        legalStateDate: "2024-06-19",
      });

      const result = chooseDisplayVersion([legacyAlias, onlyReal]);

      expect(result.defaultVersionId).toBe("tj-real");
      expect(result.warnings.some((w) => w.includes("niezależne"))).toBe(false);
    });
  });
});
