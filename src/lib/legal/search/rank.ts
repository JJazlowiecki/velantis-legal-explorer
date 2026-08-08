const RRF_K = 60;

export interface RankedCandidate {
  legalProvisionId: string;
  rank: number;
}

export interface FusedResult {
  legalProvisionId: string;
  lexicalRank: number | null;
  vectorRank: number | null;
  isExactCitationMatch: boolean;
  score: number;
}

/**
 * Reciprocal Rank Fusion: robust to unrelated score scales between lexical
 * (ts_rank_cd) and vector (cosine distance) results, since it only uses rank
 * position. Exact citation matches always sort ahead of fused results.
 */
export function fuseSearchCandidates(
  lexicalCandidates: RankedCandidate[],
  vectorCandidates: RankedCandidate[],
  exactCitationProvisionIds: ReadonlySet<string>,
): FusedResult[] {
  const lexicalByProvision = new Map(lexicalCandidates.map((c) => [c.legalProvisionId, c.rank]));
  const vectorByProvision = new Map(vectorCandidates.map((c) => [c.legalProvisionId, c.rank]));

  const provisionIds = new Set<string>([
    ...lexicalByProvision.keys(),
    ...vectorByProvision.keys(),
    ...exactCitationProvisionIds,
  ]);

  const results: FusedResult[] = [...provisionIds].map((legalProvisionId) => {
    const lexicalRank = lexicalByProvision.get(legalProvisionId) ?? null;
    const vectorRank = vectorByProvision.get(legalProvisionId) ?? null;

    const lexicalScore = lexicalRank ? 1 / (RRF_K + lexicalRank) : 0;
    const vectorScore = vectorRank ? 1 / (RRF_K + vectorRank) : 0;

    return {
      legalProvisionId,
      lexicalRank,
      vectorRank,
      isExactCitationMatch: exactCitationProvisionIds.has(legalProvisionId),
      score: lexicalScore + vectorScore,
    };
  });

  results.sort((a, b) => {
    if (a.isExactCitationMatch !== b.isExactCitationMatch) {
      return a.isExactCitationMatch ? -1 : 1;
    }
    return b.score - a.score;
  });

  return results;
}
