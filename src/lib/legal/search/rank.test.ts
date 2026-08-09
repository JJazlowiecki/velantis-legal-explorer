import { describe, expect, it } from "vitest";

import { fuseSearchCandidates } from "./rank";

describe("fuseSearchCandidates", () => {
  it("ranks documents found by both lexical and vector search ahead of single-source hits", () => {
    const fused = fuseSearchCandidates(
      [
        { legalProvisionId: "a", rank: 1 },
        { legalProvisionId: "b", rank: 2 },
      ],
      [
        { legalProvisionId: "a", rank: 2, similarity: 0.9 },
        { legalProvisionId: "c", rank: 1, similarity: 0.95 },
      ],
      new Set(),
    );

    expect(fused[0].legalProvisionId).toBe("a");
    expect(fused[0].lexicalRank).toBe(1);
    expect(fused[0].vectorRank).toBe(2);
    expect(fused[0].vectorSimilarity).toBe(0.9);
  });

  it("puts exact citation matches ahead of everything else regardless of fused score", () => {
    const fused = fuseSearchCandidates(
      [{ legalProvisionId: "strong-lexical", rank: 1 }],
      [{ legalProvisionId: "strong-vector", rank: 1, similarity: 0.9 }],
      new Set(["weak-exact-match"]),
    );

    expect(fused[0].legalProvisionId).toBe("weak-exact-match");
    expect(fused[0].isExactCitationMatch).toBe(true);
  });

  it("includes exact matches even when absent from lexical/vector candidates", () => {
    const fused = fuseSearchCandidates([], [], new Set(["only-exact"]));
    expect(fused).toHaveLength(1);
    expect(fused[0]).toMatchObject({
      legalProvisionId: "only-exact",
      lexicalRank: null,
      vectorRank: null,
      vectorSimilarity: null,
      isExactCitationMatch: true,
    });
  });

  it("returns an empty result set for no candidates", () => {
    expect(fuseSearchCandidates([], [], new Set())).toEqual([]);
  });

  it("scores documents present in only one source lower than none in this fixture", () => {
    const fused = fuseSearchCandidates([{ legalProvisionId: "lexical-only", rank: 1 }], [], new Set());
    expect(fused[0].score).toBeGreaterThan(0);
    expect(fused[0].vectorRank).toBeNull();
  });

  describe("minimum vector similarity guard", () => {
    it("keeps a strong vector-only match above the threshold", () => {
      const fused = fuseSearchCandidates(
        [],
        [{ legalProvisionId: "strong", rank: 1, similarity: 0.4 }],
        new Set(),
        { minVectorSimilarity: 0.15 },
      );

      expect(fused).toHaveLength(1);
      expect(fused[0].legalProvisionId).toBe("strong");
      expect(fused[0].vectorSimilarity).toBe(0.4);
    });

    it("removes a weak vector-only match below the threshold instead of padding results", () => {
      const fused = fuseSearchCandidates(
        [],
        [{ legalProvisionId: "weak", rank: 1, similarity: 0.02 }],
        new Set(),
        { minVectorSimilarity: 0.15 },
      );

      expect(fused).toHaveLength(0);
    });

    it("keeps a weak vector match when the same provision also has a lexical hit", () => {
      const fused = fuseSearchCandidates(
        [{ legalProvisionId: "weak-but-lexical", rank: 1 }],
        [{ legalProvisionId: "weak-but-lexical", rank: 5, similarity: 0.01 }],
        new Set(),
        { minVectorSimilarity: 0.15 },
      );

      expect(fused).toHaveLength(1);
      expect(fused[0].lexicalRank).toBe(1);
      expect(fused[0].vectorSimilarity).toBe(0.01);
    });

    it("keeps a weak vector match when the provision is an exact citation match", () => {
      const fused = fuseSearchCandidates(
        [],
        [{ legalProvisionId: "weak-but-exact", rank: 1, similarity: -0.2 }],
        new Set(["weak-but-exact"]),
        { minVectorSimilarity: 0.15 },
      );

      expect(fused).toHaveLength(1);
      expect(fused[0].isExactCitationMatch).toBe(true);
      expect(fused[0].vectorSimilarity).toBe(-0.2);
    });

    it("can remove every vector-only candidate, leaving zero results, rather than forcing padding", () => {
      const fused = fuseSearchCandidates(
        [],
        [
          { legalProvisionId: "a", rank: 1, similarity: 0.05 },
          { legalProvisionId: "b", rank: 2, similarity: 0.01 },
        ],
        new Set(),
        { minVectorSimilarity: 0.15 },
      );

      expect(fused).toEqual([]);
    });

    it("does not filter anything when no threshold is configured", () => {
      const fused = fuseSearchCandidates([], [{ legalProvisionId: "weak", rank: 1, similarity: 0.0 }], new Set());
      expect(fused).toHaveLength(1);
    });
  });
});
