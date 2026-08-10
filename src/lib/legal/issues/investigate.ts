import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema";
import type { EmbedTextsFn } from "../search/embeddings";
import { hybridLegalSearch } from "../search/service";
import type { HybridSearchResult } from "../search/types";
import { detectLegalIssues, type DetectLegalIssuesFn, type DetectLegalIssuesOptions } from "./detect";
import type { LegalIssueHypothesis, LegalIssueLikelihood, RetrievalQueryPlan } from "./schema";

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
  /** 1-based index into `LegalIssueInvestigationResult.answerTargets` — which requested aspect
   * this specific query was trying to answer. */
  answerTargetIndex: number;
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
  answerTargetIndexes: number[];
  /** The queries actually executed for this issue, AFTER the bounded-allocation cap
   * (see capRetrievalQueries) — may be a strict subset of what detection proposed. */
  retrievalQueries: RetrievalQueryPlan[];
  /** legalProvisionIds into `retrievedProvisions`, in this issue's relevance order.
   * Empty when this hypothesis found no supporting provisions — that fact is preserved,
   * never silently dropped or presented as verified. */
  retrievedProvisionIds: string[];
}

export interface AnswerTargetView {
  /** 1-based, matching every answerTargetIndex reference elsewhere in this result. */
  index: number;
  text: string;
}

export interface LegalIssueInvestigationResult {
  problemDescription: string;
  legalActVersionIds: string[];
  summary: string;
  clarificationQuestion: string | null;
  /** Concrete, user-worded requested aspects derived by issue detection — see answerTargetSchema. */
  answerTargets: AnswerTargetView[];
  issues: LegalIssueInvestigationIssue[];
  /** Deduplicated across all issues/queries. This is retrieval evidence only — not a final answer. */
  retrievedProvisions: DeduplicatedRetrievedProvision[];
}

const DEFAULT_LIMIT_PER_QUERY = 5;

/** Bounded retrieval-query allocation per answerTarget (Phase 3): a code-level backstop on top
 * of the prompt's own guidance, so query budget can never silently be dominated by peripheral
 * "possible" hypotheses regardless of what the model actually returns. `needs_more_information`
 * issues never spend retrieval budget at all — a clarifying question is the appropriate response
 * to that likelihood, not a speculative search. */
const MAX_QUERIES_PER_TARGET_MOST_LIKELY = 3;
const MAX_QUERIES_PER_TARGET_POSSIBLE = 1;

/**
 * Deterministic, pure (no network/DB) cap applied to whatever issue detection returned, before
 * any retrieval happens. Preserves original relative ordering; only removes queries once a given
 * issue has already spent its per-answerTarget allocation on an earlier query in the list.
 */
export function capRetrievalQueries(issues: LegalIssueHypothesis[]): LegalIssueHypothesis[] {
  return issues.map((issue) => {
    if (issue.likelihood === "needs_more_information") {
      return { ...issue, retrievalQueries: [] };
    }

    const maxPerTarget =
      issue.likelihood === "most_likely" ? MAX_QUERIES_PER_TARGET_MOST_LIKELY : MAX_QUERIES_PER_TARGET_POSSIBLE;

    const usedPerTarget = new Map<number, number>();
    const capped = issue.retrievalQueries.filter((queryPlan) => {
      const used = usedPerTarget.get(queryPlan.answerTargetIndex) ?? 0;
      if (used >= maxPerTarget) {
        return false;
      }
      usedPerTarget.set(queryPlan.answerTargetIndex, used + 1);
      return true;
    });

    return { ...issue, retrievalQueries: capped };
  });
}

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
  const cappedIssues = capRetrievalQueries(detection.issues);

  const answerTargets: AnswerTargetView[] = detection.answerTargets.map((target, i) => ({
    index: i + 1,
    text: target.text,
  }));

  const deduplicated = new Map<string, DeduplicatedRetrievedProvision>();
  const issues: LegalIssueInvestigationIssue[] = [];

  for (const issue of cappedIssues) {
    const provisionIdsForIssue: string[] = [];

    for (const queryPlan of issue.retrievalQueries) {
      const searchResult = await hybridLegalSearch({
        query: queryPlan.query,
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
          retrievalQuery: queryPlan.query,
          answerTargetIndex: queryPlan.answerTargetIndex,
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
      answerTargetIndexes: issue.answerTargetIndexes,
      retrievalQueries: issue.retrievalQueries,
      retrievedProvisionIds: provisionIdsForIssue,
    });
  }

  return {
    problemDescription,
    legalActVersionIds,
    summary: detection.summary,
    clarificationQuestion: detection.clarificationQuestion ?? null,
    answerTargets,
    issues,
    retrievedProvisions: [...deduplicated.values()],
  };
}
