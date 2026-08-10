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
  /** 1-based answerTarget indexes for which ensureDirectTargetQueries injected a deterministic
   * backstop query (Part 3) — i.e. the model's own queries never used the target's own wording. */
  directTargetQueriesAdded: number[];
  /** Deduplicated across all issues/queries. This is retrieval evidence only — not a final answer. */
  retrievedProvisions: DeduplicatedRetrievedProvision[];
}

/**
 * Root-caused live (Part 1 diagnosis, database-rights regression): with the fused RRF score
 * band this flat, a legitimate, well-ranked candidate can sit at fused rank 6-8 for EVERY
 * query that finds it (never rank 1, never irrelevant) and still never reach the dedup/pack
 * candidate pool under a per-query cutoff of 5 — even though target-aware packing (packing.ts)
 * is fully capable of correctly ranking and reserving it once given the chance. This is a
 * "bounded adaptive candidate pool" fix (Part 2), not a raw-limit blowout: candidates beyond
 * ~10 per query were not observed to be relevant in the live diagnosis, so this stays a small,
 * evidence-justified constant, not an unbounded search. The FINAL number of sources actually
 * sent to the model is unaffected — that is governed entirely by packing.ts's independent
 * maxSources/maxPackedCharacters budget, not by this constant.
 */
const DEFAULT_LIMIT_PER_QUERY = 10;

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

function normalizeForComparison(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface EnsureDirectTargetQueriesResult {
  issues: LegalIssueHypothesis[];
  /** 1-based answerTarget indexes for which a backstop query was actually injected (i.e. no
   * existing query already matched the target's own text closely enough). */
  directTargetQueriesAdded: number[];
}

/**
 * Part 3 deterministic backstop, applied AFTER capRetrievalQueries so the cap can never remove
 * it: for every answerTarget, guarantee at least one retrieval query is the target's own
 * wording (or an existing query already matches it near-exactly) — never a fixed legal-domain
 * ontology, purely a generic "the target text itself is always one valid query" guarantee. This
 * is what stops "jakie prawa ma producent bazy danych" from disappearing entirely just because
 * the model chose to generate only broader/generic topic queries for that target. Attaches the
 * backstop to the first (in detection order) non-`needs_more_information` issue that already
 * references the target, preserving that issue's own likelihood for downstream ranking — never
 * invents a new issue, never duplicates an existing query, and — because answerTargets is
 * capped at 4 — adds at most 4 extra queries total regardless of how many issues exist.
 */
export function ensureDirectTargetQueries(
  issues: LegalIssueHypothesis[],
  answerTargets: readonly AnswerTargetView[],
): EnsureDirectTargetQueriesResult {
  const updatedIssues = issues.map((issue) => ({ ...issue, retrievalQueries: [...issue.retrievalQueries] }));
  const directTargetQueriesAdded: number[] = [];

  for (const target of answerTargets) {
    const normalizedTarget = normalizeForComparison(target.text);
    const alreadyPresent = updatedIssues.some((issue) =>
      issue.retrievalQueries.some(
        (q) => q.answerTargetIndex === target.index && normalizeForComparison(q.query) === normalizedTarget,
      ),
    );
    if (alreadyPresent) {
      continue;
    }

    const owningIssueIndex = updatedIssues.findIndex(
      (issue) => issue.likelihood !== "needs_more_information" && issue.answerTargetIndexes.includes(target.index),
    );
    if (owningIssueIndex === -1) {
      // No issue covers this target at all — nothing to attach the backstop query to; the
      // target simply gets zero retrieval, exactly as it would without this backstop.
      continue;
    }

    updatedIssues[owningIssueIndex].retrievalQueries.push({ query: target.text, answerTargetIndex: target.index });
    directTargetQueriesAdded.push(target.index);
  }

  return { issues: updatedIssues, directTargetQueriesAdded };
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

  const { issues: backstoppedIssues, directTargetQueriesAdded } = ensureDirectTargetQueries(
    cappedIssues,
    answerTargets,
  );

  const deduplicated = new Map<string, DeduplicatedRetrievedProvision>();
  const issues: LegalIssueInvestigationIssue[] = [];

  for (const issue of backstoppedIssues) {
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
    directTargetQueriesAdded,
    retrievedProvisions: [...deduplicated.values()],
  };
}
