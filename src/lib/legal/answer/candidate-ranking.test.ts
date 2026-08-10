import { describe, expect, it } from "vitest";

import type { DeduplicatedRetrievedProvision, RetrievalProvenanceEntry } from "../issues/investigate";
import { compareCandidates, rankCandidates, scoreCandidate } from "./candidate-ranking";

function provenance(overrides: Partial<RetrievalProvenanceEntry> = {}): RetrievalProvenanceEntry {
  return {
    issueLabel: "issue",
    issueLikelihood: "possible",
    retrievalQuery: "q",
    answerTargetIndex: 1,
    lexicalRank: null,
    vectorRank: null,
    vectorSimilarity: null,
    isExactCitationMatch: false,
    finalScore: 0.03,
    ...overrides,
  };
}

function provision(
  citationLabel: string,
  foundBy: RetrievalProvenanceEntry[],
): DeduplicatedRetrievedProvision {
  return {
    legalProvisionId: citationLabel,
    legalActVersionId: "v1",
    legalActId: "a1",
    actTitle: "Act",
    citationLabel,
    text: "text",
    hierarchy: [],
    versionKind: "consolidated",
    authorityClass: "authoritative",
    currentnessStatus: "unproven",
    sourceExpressionId: "tj",
    foundBy,
  };
}

describe("scoreCandidate", () => {
  it("weights a most_likely hit above an equal-score possible-only hit", () => {
    const mostLikely = provision("art. 6", [provenance({ issueLikelihood: "most_likely", finalScore: 0.03 })]);
    const possible = provision("art. 13", [provenance({ issueLikelihood: "possible", finalScore: 0.03 })]);

    expect(scoreCandidate(mostLikely).score).toBeGreaterThan(scoreCandidate(possible).score);
  });

  it("never sums across issues within the same tier — uses max, not accumulation", () => {
    const foundByOneQuery = provision("art. 6", [provenance({ issueLikelihood: "most_likely", finalScore: 0.03 })]);
    const foundByThreeQueries = provision("art. 13", [
      provenance({ issueLikelihood: "possible", finalScore: 0.029 }),
      provenance({ issueLikelihood: "possible", finalScore: 0.028 }),
      provenance({ issueLikelihood: "possible", finalScore: 0.027 }),
    ]);

    // Three mediocre peripheral hits must never outrank one strong central hit purely by being
    // found more often — this is the exact "cross-issue accumulation" failure mode being fixed.
    expect(scoreCandidate(foundByOneQuery).score).toBeGreaterThan(scoreCandidate(foundByThreeQueries).score);
  });

  it("uses the best score within each tier, not the first entry", () => {
    const p = provision("art. 6", [
      provenance({ issueLikelihood: "most_likely", finalScore: 0.01 }),
      provenance({ issueLikelihood: "most_likely", finalScore: 0.05 }),
    ]);
    expect(scoreCandidate(p).bestMostLikelyScore).toBe(0.05);
  });

  it("reports null for a tier with no hits", () => {
    const p = provision("art. 6", [provenance({ issueLikelihood: "most_likely", finalScore: 0.03 })]);
    expect(scoreCandidate(p).bestPossibleScore).toBeNull();
  });
});

describe("compareCandidates / rankCandidates", () => {
  it("always ranks an exact citation match first regardless of score", () => {
    const exact = provision("art. 6", [
      provenance({ issueLikelihood: "possible", finalScore: 0.001, isExactCitationMatch: true }),
    ]);
    const strongButNotExact = provision("art. 7", [provenance({ issueLikelihood: "most_likely", finalScore: 0.033 })]);

    const ranked = rankCandidates([strongButNotExact, exact]);
    expect(ranked[0].citationLabel).toBe("art. 6");
  });

  it("breaks exact ties deterministically by citationLabel", () => {
    const a = provision("art. 9", [provenance({ issueLikelihood: "most_likely", finalScore: 0.03 })]);
    const b = provision("art. 2", [provenance({ issueLikelihood: "most_likely", finalScore: 0.03 })]);
    const ranked = rankCandidates([a, b]);
    expect(ranked.map((p) => p.citationLabel)).toEqual(["art. 2", "art. 9"]);
  });

  it("reproduces the database-rights regression: a most_likely-found provision outranks a possible-only one with a higher raw fused score", () => {
    // This mirrors the live trace: art. 6 ust. 1 (finalScore 0.0305, found only via a
    // possible-likelihood query) vs. art. 11 ust. 1 (finalScore 0.0311, found via a
    // most_likely query) — under the OLD flat ranking art. 6 ust. 1 lost by raw score even
    // when found via most_likely; this test instead sets up the inverse to prove the new
    // ranking corrects the general failure mode, not just the one observed case.
    const foundByPossibleOnly = provision("art. 13", [
      provenance({ issueLikelihood: "possible", finalScore: 0.033 }),
    ]);
    const foundByMostLikely = provision("art. 6 ust. 1", [
      provenance({ issueLikelihood: "most_likely", finalScore: 0.0305 }),
    ]);

    const ranked = rankCandidates([foundByPossibleOnly, foundByMostLikely]);
    expect(ranked[0].citationLabel).toBe("art. 6 ust. 1");
  });

  it("compareCandidates is a valid comparator usable directly with Array.prototype.sort", () => {
    const items = [
      provision("art. 3", [provenance({ issueLikelihood: "possible", finalScore: 0.01 })]),
      provision("art. 1", [provenance({ issueLikelihood: "most_likely", finalScore: 0.02 })]),
    ];
    items.sort(compareCandidates);
    expect(items[0].citationLabel).toBe("art. 1");
  });
});
