import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema";
import type { EmbedTextsFn } from "../search/embeddings";
import { hybridLegalSearch } from "../search/service";
import type { HybridSearchResult } from "../search/types";
import { detectLegalIssues, type DetectLegalIssuesFn, type DetectLegalIssuesOptions } from "./detect";
import type { LegalIssueLikelihood } from "./schema";

export class LegalIssueInvestigationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegalIssueInvestigationError";
  }
}

export interface InvestigateLegalProblemOptions {
  problemDescription: string;
  legalActVersionIds: string[];
  limitPerQuery?: number;
  db?: PostgresJsDatabase<typeof schema>;
  embedTexts?: EmbedTextsFn;
  minVectorSimilarity?: number;
  detectIssues?: DetectLegalIssuesFn;
  detectIssuesOptions?: DetectLegalIssuesOptions;
}

/** Where a deduplicated provision came from: one entry per (issue, query) pair that surfaced it. */
export interface RetrievalProvenanceEntry {
  issueLabel: string;
  issueLikelihood: LegalIssueLikelihood;
  retrievalQuery: string;
  lexicalRank: number | null;
  vectorRank: number | null;
  vectorSimilarity: number | null;
  isExactCitationMatch: boolean;
  finalScore: number;
}

export interface DeduplicatedRetrievedProvision
  extends Omit<HybridSearchResult, "lexicalRank" | "vectorRank" | "vectorSimilarity" | "isExactCitationMatch" | "finalScore"> {
  /** Every issue hypothesis + retrieval query that surfaced this provision. A provision found by
   * multiple hypotheses (or multiple queries within one hypothesis) appears once here, not duplicated. */
  foundBy: RetrievalProvenanceEntry[];
}

export interface LegalIssueInvestigationIssue {
  label: string;
  likelihood: LegalIssueLikelihood;
  rationale: string;
  retrievalQueries: string[];
  /** legalProvisionIds into `retrievedProvisions`, in this issue's relevance order.
   * Empty when this hypothesis found no supporting provisions — that fact is preserved,
   * never silently dropped or presented as verified. */
  retrievedProvisionIds: string[];
}

export interface LegalIssueInvestigationResult {
  problemDescription: string;
  legalActVersionIds: string[];
  summary: string;
  clarificationQuestion: string | null;
  issues: LegalIssueInvestigationIssue[];
  /** Deduplicated across all issues/queries. This is retrieval evidence only — not a final answer. */
  retrievedProvisions: DeduplicatedRetrievedProvision[];
}

const DEFAULT_LIMIT_PER_QUERY = 5;

export async function investigateLegalProblem(
  options: InvestigateLegalProblemOptions,
): Promise<LegalIssueInvestigationResult> {
  if (!options.legalActVersionIds || options.legalActVersionIds.length === 0) {
    throw new LegalIssueInvestigationError(
      "legalActVersionIds is required and must be non-empty: never search a global default corpus",
    );
  }

  const problemDescription = options.problemDescription.trim();
  if (!problemDescription) {
    throw new LegalIssueInvestigationError("problemDescription must not be empty");
  }

  const legalActVersionIds = [...new Set(options.legalActVersionIds)];
  const limitPerQuery = options.limitPerQuery ?? DEFAULT_LIMIT_PER_QUERY;
  const detectIssues = options.detectIssues ?? detectLegalIssues;

  const detection = await detectIssues(problemDescription, options.detectIssuesOptions);

  const deduplicated = new Map<string, DeduplicatedRetrievedProvision>();
  const issues: LegalIssueInvestigationIssue[] = [];

  for (const issue of detection.issues) {
    const provisionIdsForIssue: string[] = [];

    for (const retrievalQuery of issue.retrievalQueries) {
      const searchResult = await hybridLegalSearch({
        query: retrievalQuery,
        legalActVersionIds,
        limit: limitPerQuery,
        db: options.db,
        embedTexts: options.embedTexts,
        minVectorSimilarity: options.minVectorSimilarity,
      });

      for (const hit of searchResult.results) {
        if (!provisionIdsForIssue.includes(hit.legalProvisionId)) {
          provisionIdsForIssue.push(hit.legalProvisionId);
        }

        const provenance: RetrievalProvenanceEntry = {
          issueLabel: issue.label,
          issueLikelihood: issue.likelihood,
          retrievalQuery,
          lexicalRank: hit.lexicalRank,
          vectorRank: hit.vectorRank,
          vectorSimilarity: hit.vectorSimilarity,
          isExactCitationMatch: hit.isExactCitationMatch,
          finalScore: hit.finalScore,
        };

        const existing = deduplicated.get(hit.legalProvisionId);
        if (existing) {
          existing.foundBy.push(provenance);
        } else {
          deduplicated.set(hit.legalProvisionId, {
            legalProvisionId: hit.legalProvisionId,
            legalActVersionId: hit.legalActVersionId,
            legalActId: hit.legalActId,
            actTitle: hit.actTitle,
            citationLabel: hit.citationLabel,
            text: hit.text,
            hierarchy: hit.hierarchy,
            versionKind: hit.versionKind,
            authorityClass: hit.authorityClass,
            currentnessStatus: hit.currentnessStatus,
            sourceExpressionId: hit.sourceExpressionId,
            foundBy: [provenance],
          });
        }
      }
    }

    issues.push({
      label: issue.label,
      likelihood: issue.likelihood,
      rationale: issue.rationale,
      retrievalQueries: issue.retrievalQueries,
      retrievedProvisionIds: provisionIdsForIssue,
    });
  }

  return {
    problemDescription,
    legalActVersionIds,
    summary: detection.summary,
    clarificationQuestion: detection.clarificationQuestion ?? null,
    issues,
    retrievedProvisions: [...deduplicated.values()],
  };
}
