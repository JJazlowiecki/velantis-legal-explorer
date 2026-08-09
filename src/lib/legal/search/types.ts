export interface HybridSearchResult {
  legalProvisionId: string;
  legalActVersionId: string;
  legalActId: string;
  actTitle: string;
  citationLabel: string;
  text: string;
  hierarchy: string[];
  lexicalRank: number | null;
  vectorRank: number | null;
  vectorSimilarity: number | null;
  isExactCitationMatch: boolean;
  finalScore: number;
  versionKind: string;
  authorityClass: string;
  currentnessStatus: string;
  sourceExpressionId: string;
}
