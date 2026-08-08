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
        { legalProvisionId: "a", rank: 2 },
        { legalProvisionId: "c", rank: 1 },
      ],
      new Set(),
    );

    expect(fused[0].legalProvisionId).toBe("a");
    expect(fused[0].lexicalRank).toBe(1);
    expect(fused[0].vectorRank).toBe(2);
  });

  it("puts exact citation matches ahead of everything else regardless of fused score", () => {
    const fused = fuseSearchCandidates(
      [{ legalProvisionId: "strong-lexical", rank: 1 }],
      [{ legalProvisionId: "strong-vector", rank: 1 }],
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
      isExactCitationMatch: true,
    });
  });

  it("returns an empty result set for no candidates", () => {
    expect(fuseSearchCandidates([], [], new Set())).toEqual([]);
  });

  it("scores documents present in only one source lower than none in this fixture", () => {
    const fused = fuseSearchCandidates(
      [{ legalProvisionId: "lexical-only", rank: 1 }],
      [],
      new Set(),
    );
    expect(fused[0].score).toBeGreaterThan(0);
    expect(fused[0].vectorRank).toBeNull();
  });
});
