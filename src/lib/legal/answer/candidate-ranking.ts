import type { DeduplicatedRetrievedProvision, RetrievalProvenanceEntry } from "../issues/investigate";

/**
 * Fixes the "cross-issue RRF distortion" observed live for the database-rights query: `rank.ts`'s
 * RRF (RRF_K=60) already produces a very flat score band per query (~0.029-0.033), so once
 * results from many queries are pooled, small rank noise — not topical centrality — decides
 * survival. Packing previously sorted purely by `Math.max(foundBy[].finalScore)`, which is
 * ALREADY tier-blind: a provision found only through a peripheral "possible" hypothesis competed
 * on exactly equal footing with one found through the user's actual "most_likely" question. This
 * is not a literal score-accumulation bug (packing never summed across foundBy, only took the
 * max) — the real distortion is opportunity: peripheral issues had a larger retrieval-query
 * budget (before Phase 3's cap), so central evidence had fewer chances at a good per-query rank.
 *
 * This score is deliberately still MAX-based (never sums across issues or queries — summing
 * would let a provision "found by many mediocre peripheral queries" outrank one strongly found
 * by the single most_likely query, exactly the failure mode being fixed) but now WEIGHTS the
 * tier a hit came from: a hit from a most_likely issue always outweighs a hit from a
 * possible-only issue, by a fixed, documented multiplier — never a per-request-tunable knob.
 */
const MOST_LIKELY_WEIGHT = 2;
const POSSIBLE_WEIGHT = 1;

export interface CandidateRankScore {
  /** Exact citation matches always rank first, exactly as before — unchanged from packing.ts. */
  isExactCitationMatch: boolean;
  /** Deterministic, tier-weighted rank score. Higher is better. */
  score: number;
  /** best raw fused score found via a most_likely issue, if any — exposed for the debug trace. */
  bestMostLikelyScore: number | null;
  /** best raw fused score found via a possible issue, if any — exposed for the debug trace. */
  bestPossibleScore: number | null;
}

function bestScoreForLikelihood(
  foundBy: readonly RetrievalProvenanceEntry[],
  likelihood: "most_likely" | "possible",
): number | null {
  const scores = foundBy.filter((entry) => entry.issueLikelihood === likelihood).map((entry) => entry.finalScore);
  return scores.length > 0 ? Math.max(...scores) : null;
}

export function scoreCandidate(provision: DeduplicatedRetrievedProvision): CandidateRankScore {
  const isExactCitationMatch = provision.foundBy.some((entry) => entry.isExactCitationMatch);
  const bestMostLikelyScore = bestScoreForLikelihood(provision.foundBy, "most_likely");
  const bestPossibleScore = bestScoreForLikelihood(provision.foundBy, "possible");

  // needs_more_information issues never reach retrieval (Phase 3: zero queries run for them),
  // so foundBy can only ever contain most_likely/possible entries here.
  const score = (bestMostLikelyScore ?? 0) * MOST_LIKELY_WEIGHT + (bestPossibleScore ?? 0) * POSSIBLE_WEIGHT;

  return { isExactCitationMatch, score, bestMostLikelyScore, bestPossibleScore };
}

/**
 * Deterministic total order: exact citation match first, then tier-weighted score, then
 * citationLabel as a final stable tiebreak (unchanged from the original packing.ts comparator).
 */
export function compareCandidates(a: DeduplicatedRetrievedProvision, b: DeduplicatedRetrievedProvision): number {
  const scoreA = scoreCandidate(a);
  const scoreB = scoreCandidate(b);

  if (scoreA.isExactCitationMatch !== scoreB.isExactCitationMatch) {
    return scoreA.isExactCitationMatch ? -1 : 1;
  }

  if (scoreA.score !== scoreB.score) {
    return scoreB.score - scoreA.score;
  }

  return a.citationLabel.localeCompare(b.citationLabel);
}

export function rankCandidates(provisions: readonly DeduplicatedRetrievedProvision[]): DeduplicatedRetrievedProvision[] {
  return [...provisions].sort(compareCandidates);
}

/**
 * Part 4 hardening: once every query belongs to a single most_likely issue (the common case
 * after Phase 2/3 discipline), the global `scoreCandidate` above can no longer distinguish
 * "strong match for THIS answerTarget's own query" from "strong match for a sibling query
 * tied to a DIFFERENT target under the same issue" — a candidate could win a target's PASS-1
 * reservation in packing.ts purely because it scored well for some OTHER target. This variant
 * restricts every signal (exact citation, most_likely/possible tiers) to `foundBy` entries
 * whose `answerTargetIndex` matches the target being scored FOR — preventing that
 * cross-target contamination. Still never sums across queries within a tier (same max-based
 * discipline as scoreCandidate).
 */
export function scoreCandidateForTarget(provision: DeduplicatedRetrievedProvision, targetIndex: number): CandidateRankScore {
  const targetFoundBy = provision.foundBy.filter((entry) => entry.answerTargetIndex === targetIndex);
  const isExactCitationMatch = targetFoundBy.some((entry) => entry.isExactCitationMatch);
  const bestMostLikelyScore = bestScoreForLikelihood(targetFoundBy, "most_likely");
  const bestPossibleScore = bestScoreForLikelihood(targetFoundBy, "possible");
  const score = (bestMostLikelyScore ?? 0) * MOST_LIKELY_WEIGHT + (bestPossibleScore ?? 0) * POSSIBLE_WEIGHT;

  return { isExactCitationMatch, score, bestMostLikelyScore, bestPossibleScore };
}

export function compareCandidatesForTarget(
  a: DeduplicatedRetrievedProvision,
  b: DeduplicatedRetrievedProvision,
  targetIndex: number,
): number {
  const scoreA = scoreCandidateForTarget(a, targetIndex);
  const scoreB = scoreCandidateForTarget(b, targetIndex);

  if (scoreA.isExactCitationMatch !== scoreB.isExactCitationMatch) {
    return scoreA.isExactCitationMatch ? -1 : 1;
  }

  if (scoreA.score !== scoreB.score) {
    return scoreB.score - scoreA.score;
  }

  return a.citationLabel.localeCompare(b.citationLabel);
}

export function rankCandidatesForTarget(
  provisions: readonly DeduplicatedRetrievedProvision[],
  targetIndex: number,
): DeduplicatedRetrievedProvision[] {
  return [...provisions].sort((a, b) => compareCandidatesForTarget(a, b, targetIndex));
}
