const RRF_K = 60;

export interface RankedCandidate {
  legalProvisionId: string;
  rank: number;
}

export interface VectorRankedCandidate extends RankedCandidate {
  /** Cosine similarity in [-1, 1]. Higher is more similar. */
  similarity: number;
}

export interface FusedResult {
  legalProvisionId: string;
  lexicalRank: number | null;
  vectorRank: number | null;
  vectorSimilarity: number | null;
  isExactCitationMatch: boolean;
  score: number;
}

export interface FuseSearchCandidatesOptions {
  /**
   * Minimum cosine similarity required for a candidate found ONLY through vector
   * search to be kept. Never applied to exact citation matches or to candidates
   * that also have a lexical match — those survive regardless of vector similarity.
   * Omit or 0 to disable (no filtering).
   */
  minVectorSimilarity?: number;
}

/**
 * Reciprocal Rank Fusion: robust to unrelated score scales between lexical
 * (ts_rank_cd) and vector (cosine distance) results, since it only uses rank
 * position. Exact citation matches always sort ahead of fused results.
 *
 * A minimum vector-similarity quality guard prevents weak vector-only
 * candidates (found by no other signal) from padding results on small
 * corpora, where plain top-K nearest-neighbor search always returns
 * something even when nothing is actually relevant.
 */
export function fuseSearchCandidates(
  lexicalCandidates: RankedCandidate[],
  vectorCandidates: VectorRankedCandidate[],
  exactCitationProvisionIds: ReadonlySet<string>,
  options: FuseSearchCandidatesOptions = {},
): FusedResult[] {
  const minVectorSimilarity = options.minVectorSimilarity ?? 0;

  const lexicalByProvision = new Map(lexicalCandidates.map((c) => [c.legalProvisionId, c.rank]));
  const vectorByProvision = new Map(vectorCandidates.map((c) => [c.legalProvisionId, c]));

  const provisionIds = new Set<string>([
    ...lexicalByProvision.keys(),
    ...vectorByProvision.keys(),
    ...exactCitationProvisionIds,
  ]);

  const results: FusedResult[] = [...provisionIds]
    .map((legalProvisionId) => {
      const lexicalRank = lexicalByProvision.get(legalProvisionId) ?? null;
      const vectorCandidate = vectorByProvision.get(legalProvisionId) ?? null;
      const vectorRank = vectorCandidate?.rank ?? null;
      const vectorSimilarity = vectorCandidate?.similarity ?? null;
      const isExactCitationMatch = exactCitationProvisionIds.has(legalProvisionId);

      const lexicalScore = lexicalRank ? 1 / (RRF_K + lexicalRank) : 0;
      const vectorScore = vectorRank ? 1 / (RRF_K + vectorRank) : 0;

      return {
        legalProvisionId,
        lexicalRank,
        vectorRank,
        vectorSimilarity,
        isExactCitationMatch,
        score: lexicalScore + vectorScore,
      };
    })
    .filter((candidate) => {
      const isVectorOnly =
        candidate.vectorRank !== null && candidate.lexicalRank === null && !candidate.isExactCitationMatch;
      if (!isVectorOnly) {
        return true;
      }
      return (candidate.vectorSimilarity ?? 0) >= minVectorSimilarity;
    });

  results.sort((a, b) => {
    if (a.isExactCitationMatch !== b.isExactCitationMatch) {
      return a.isExactCitationMatch ? -1 : 1;
    }
    return b.score - a.score;
  });

  return results;
}
