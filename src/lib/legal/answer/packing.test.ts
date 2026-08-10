import { describe, expect, it } from "vitest";

import type { DeduplicatedRetrievedProvision, RetrievalProvenanceEntry } from "../issues/investigate";
import { packSources } from "./packing";

function provenance(overrides: Partial<RetrievalProvenanceEntry> = {}): RetrievalProvenanceEntry {
  return {
    issueLabel: "issue",
    issueLikelihood: "possible",
    retrievalQuery: "query",
    answerTargetIndex: 1,
    lexicalRank: null,
    vectorRank: 1,
    vectorSimilarity: 0.5,
    isExactCitationMatch: false,
    finalScore: 0.01,
    ...overrides,
  };
}

function provision(overrides: Partial<DeduplicatedRetrievedProvision> = {}): DeduplicatedRetrievedProvision {
  return {
    legalProvisionId: "p1",
    legalActVersionId: "v1",
    legalActId: "a1",
    actTitle: "Ustawa testowa",
    citationLabel: "art. 1",
    text: "Art. 1. Tekst.",
    hierarchy: ["Dział I"],
    versionKind: "promulgated",
    authorityClass: "authoritative",
    currentnessStatus: "unproven",
    sourceExpressionId: "ogl",
    foundBy: [provenance()],
    ...overrides,
  };
}

describe("packSources", () => {
  it("assigns stable SOURCE_1, SOURCE_2, ... identifiers", () => {
    const packed = packSources([
      provision({ legalProvisionId: "p1", foundBy: [provenance({ finalScore: 0.02 })] }),
      provision({ legalProvisionId: "p2", foundBy: [provenance({ finalScore: 0.01 })] }),
    ]);

    expect(packed.map((s) => s.sourceId)).toEqual(["SOURCE_1", "SOURCE_2"]);
  });

  it("deduplicates by legalProvisionId even if the same provision appears twice in the input", () => {
    const packed = packSources([
      provision({ legalProvisionId: "dup", foundBy: [provenance({ issueLabel: "issue A" })] }),
      provision({ legalProvisionId: "dup", foundBy: [provenance({ issueLabel: "issue B" })] }),
      provision({ legalProvisionId: "other" }),
    ]);

    expect(packed).toHaveLength(2);
    expect(packed.filter((s) => s.legalProvisionId === "dup")).toHaveLength(1);
  });

  it("ranks exact citation matches ahead of fuzzy results regardless of score", () => {
    const packed = packSources([
      provision({ legalProvisionId: "fuzzy", foundBy: [provenance({ finalScore: 0.9, isExactCitationMatch: false })] }),
      provision({ legalProvisionId: "exact", foundBy: [provenance({ finalScore: 0.01, isExactCitationMatch: true })] }),
    ]);

    expect(packed[0].legalProvisionId).toBe("exact");
    expect(packed[0].sourceId).toBe("SOURCE_1");
  });

  it("ranks by best fused score when no exact match is present", () => {
    const packed = packSources([
      provision({ legalProvisionId: "weak", foundBy: [provenance({ finalScore: 0.01 })] }),
      provision({ legalProvisionId: "strong", foundBy: [provenance({ finalScore: 0.05 })] }),
    ]);

    expect(packed[0].legalProvisionId).toBe("strong");
  });

  it("bounds the packed set to a simple explicit maximum", () => {
    const provisions = Array.from({ length: 20 }, (_, i) =>
      provision({ legalProvisionId: `p${i}`, citationLabel: `art. ${i}`, foundBy: [provenance({ finalScore: i })] }),
    );

    const packed = packSources(provisions, { maxSources: 5 });
    expect(packed).toHaveLength(5);
    // highest scores kept
    expect(packed.map((s) => s.legalProvisionId)).toEqual(["p19", "p18", "p17", "p16", "p15"]);
  });

  it("preserves full source/version/authority metadata and hierarchy for each packed source", () => {
    const packed = packSources([
      provision({
        legalProvisionId: "p1",
        actTitle: "Kodeks postępowania administracyjnego",
        citationLabel: "art. 16 § 1",
        text: "§ 1. Właściwość rzeczową organu...",
        hierarchy: ["Dział I - Przepisy ogólne", "Rozdział 3 - Właściwość organów"],
        versionKind: "promulgated",
        authorityClass: "authoritative",
        currentnessStatus: "unproven",
        sourceExpressionId: "ogl",
      }),
    ]);

    expect(packed[0]).toMatchObject({
      legalProvisionId: "p1",
      actTitle: "Kodeks postępowania administracyjnego",
      citationLabel: "art. 16 § 1",
      text: "§ 1. Właściwość rzeczową organu...",
      hierarchy: ["Dział I - Przepisy ogólne", "Rozdział 3 - Właściwość organów"],
      versionKind: "promulgated",
      authorityClass: "authoritative",
      currentnessStatus: "unproven",
      sourceExpressionId: "ogl",
    });
  });

  it("returns an empty array for no provisions", () => {
    expect(packSources([])).toEqual([]);
  });

  describe("answerTarget-aware reservation (PASS 1)", () => {
    it("reserves the best most_likely-found candidate for a target even though it ranks below the global fixed cut", () => {
      // Reproduces the live database-rights defect: art. 6 ust. 1 (found via a most_likely
      // issue, but with a mediocre raw finalScore) was previously cut by a flat maxSources=12
      // ranking even though 8+ candidates found ONLY via possible issues outranked it by raw
      // score alone.
      const central = provision({
        legalProvisionId: "art-6-ust-1",
        citationLabel: "art. 6 ust. 1",
        foundBy: [provenance({ issueLikelihood: "most_likely", answerTargetIndex: 1, finalScore: 0.02 })],
      });
      const peripherals = Array.from({ length: 11 }, (_, i) =>
        provision({
          legalProvisionId: `peripheral-${i}`,
          citationLabel: `art. ${i}`,
          foundBy: [provenance({ issueLikelihood: "possible", answerTargetIndex: 2, finalScore: 0.033 })],
        }),
      );

      const packed = packSources([...peripherals, central], {
        maxSources: 5,
        answerTargets: [{ index: 1, text: "jakie prawa ma producent" }],
      });

      expect(packed.some((s) => s.legalProvisionId === "art-6-ust-1")).toBe(true);
    });

    it("tags a reserved source with the answerTargetIndex it was reserved for", () => {
      const central = provision({
        legalProvisionId: "p1",
        foundBy: [provenance({ issueLikelihood: "most_likely", answerTargetIndex: 2, finalScore: 0.02 })],
      });
      const packed = packSources([central], { answerTargets: [{ index: 2, text: "target" }] });
      expect(packed[0].reservedForAnswerTargetIndexes).toEqual([2]);
    });

    it("leaves reservedForAnswerTargetIndexes empty for a pass-2 (global-fill) source", () => {
      const p = provision({ foundBy: [provenance({ issueLikelihood: "possible", answerTargetIndex: 1 })] });
      const packed = packSources([p], { answerTargets: [{ index: 1, text: "unrelated target" }] });
      // Nothing was found via a most_likely issue for target 1, so nothing is reserved — the
      // single candidate is packed only via pass 2.
      expect(packed[0].reservedForAnswerTargetIndexes).toEqual([]);
    });

    it("skips a target with no qualifying most_likely-found candidate rather than forcing weak coverage", () => {
      const onlyPossible = provision({ foundBy: [provenance({ issueLikelihood: "possible", answerTargetIndex: 1 })] });
      // No error, no fabricated source — packing proceeds via pass 2 only.
      const packed = packSources([onlyPossible], { answerTargets: [{ index: 1, text: "target" }] });
      expect(packed).toHaveLength(1);
      expect(packed[0].reservedForAnswerTargetIndexes).toEqual([]);
    });

    it("reserves one representative per distinct target, up to maxSources", () => {
      const t1 = provision({
        legalProvisionId: "t1-best",
        foundBy: [provenance({ issueLikelihood: "most_likely", answerTargetIndex: 1, finalScore: 0.01 })],
      });
      const t2 = provision({
        legalProvisionId: "t2-best",
        foundBy: [provenance({ issueLikelihood: "most_likely", answerTargetIndex: 2, finalScore: 0.01 })],
      });
      const packed = packSources([t1, t2], {
        answerTargets: [
          { index: 1, text: "target 1" },
          { index: 2, text: "target 2" },
        ],
      });
      expect(packed.map((s) => s.legalProvisionId).sort()).toEqual(["t1-best", "t2-best"]);
    });

    it("falls back to pure global-ranked packing when no answerTargets are supplied (backward compatible)", () => {
      const packed = packSources([
        provision({ legalProvisionId: "weak", foundBy: [provenance({ finalScore: 0.01 })] }),
        provision({ legalProvisionId: "strong", foundBy: [provenance({ finalScore: 0.05 })] }),
      ]);
      expect(packed[0].legalProvisionId).toBe("strong");
      expect(packed[0].reservedForAnswerTargetIndexes).toEqual([]);
    });
  });

  describe("maxPackedCharacters (token-budget-aware pack size)", () => {
    it("stops admitting further sources once the character budget is exhausted", () => {
      const provisions = Array.from({ length: 5 }, (_, i) =>
        provision({
          legalProvisionId: `p${i}`,
          citationLabel: `art. ${i}`,
          text: "x".repeat(1000),
          foundBy: [provenance({ finalScore: 5 - i })],
        }),
      );

      const packed = packSources(provisions, { maxSources: 20, maxPackedCharacters: 2500 });
      // 2 full sources (2000 chars) fit; the 3rd (3000 total) would exceed the 2500 budget.
      expect(packed).toHaveLength(2);
    });

    it("always admits at least one source even if it alone exceeds the character budget", () => {
      const huge = provision({ text: "x".repeat(50_000) });
      const packed = packSources([huge], { maxPackedCharacters: 100 });
      expect(packed).toHaveLength(1);
    });

    it("lets a later, shorter candidate still fit after an earlier long one is skipped by the budget", () => {
      const long = provision({
        legalProvisionId: "long",
        text: "x".repeat(2000),
        foundBy: [provenance({ finalScore: 0.05 })],
      });
      const short = provision({
        legalProvisionId: "short",
        text: "y".repeat(10),
        foundBy: [provenance({ finalScore: 0.04 })],
      });
      const first = provision({
        legalProvisionId: "first",
        text: "z".repeat(50),
        foundBy: [provenance({ finalScore: 0.06 })],
      });

      const packed = packSources([long, short, first], { maxPackedCharacters: 100 });
      const ids = packed.map((s) => s.legalProvisionId);
      expect(ids).toContain("first");
      expect(ids).toContain("short");
      expect(ids).not.toContain("long");
    });
  });

  describe("provenCurrentAsOf (current-law-corpus provenance)", () => {
    it("is null when no currentCorpusContext is supplied (historical/test mode)", () => {
      const packed = packSources([provision({ legalActVersionId: "v1" })]);
      expect(packed[0].provenCurrentAsOf).toBeNull();
    });

    it("is set to the run's effectiveAsOf when the source's version is a member of the supplied current corpus", () => {
      const packed = packSources([provision({ legalActVersionId: "v1" })], {
        currentCorpusContext: { legalActVersionIds: ["v1", "v2"], effectiveAsOf: "2026-08-09" },
      });
      expect(packed[0].provenCurrentAsOf).toBe("2026-08-09");
    });

    it("stays null for a version NOT in the supplied current corpus, even when a context is passed (a different run's provenance can never apply accidentally)", () => {
      const packed = packSources([provision({ legalActVersionId: "v-outside-run" })], {
        currentCorpusContext: { legalActVersionIds: ["v1", "v2"], effectiveAsOf: "2026-08-09" },
      });
      expect(packed[0].provenCurrentAsOf).toBeNull();
    });
  });
});
