import type { LegalAnswerResult, LegalAnswerStatus } from "@/lib/legal/answer/answer";

/**
 * Deliberately narrow: only what the UI needs to render a trustworthy answer. Internal
 * implementation details (sourceId/SOURCE_X placeholders, legalProvisionId, legalActVersionId,
 * versionKind, sourceExpressionId, vector/lexical ranks, embeddings) are never included here —
 * they stop at the server boundary in `LegalAnswerResult`.
 */
export interface ExplorerCitedSource {
  actTitle: string;
  citationLabel: string;
  text: string;
  isNonAuthoritative: boolean;
  isCurrentnessUnproven: boolean;
  /** Set only when this citation was confirmed authoritative_current by a pinned current-law-corpus run — the run's effectiveAsOf date. Null in historical/test mode or when not covered. */
  provenCurrentAsOf: string | null;
}

export interface ExplorerConclusionView {
  statement: string;
  citationLabels: string[];
}

export interface ExplorerAlternativePathView {
  issueLabel: string;
  explanation: string;
  citationLabels: string[];
}

export interface ExplorerAnswerView {
  status: LegalAnswerStatus;
  answer: string;
  conclusions: ExplorerConclusionView[];
  alternativePaths: ExplorerAlternativePathView[];
  uncertainties: string[];
  citedSources: ExplorerCitedSource[];
  clarificationQuestion: string | null;
}

export type ExplorerSearchResult =
  | { ok: true; data: ExplorerAnswerView; historyEntryId?: string }
  | { ok: false; error: string };

/** Only sources actually cited by a verified conclusion or alternative path — not the full packed evidence set. */
function selectCitedSources(result: LegalAnswerResult): ExplorerCitedSource[] {
  const citedProvisionIds = new Set(
    [...result.conclusions, ...result.alternativePaths].flatMap((item) =>
      item.support.map((source) => source.legalProvisionId),
    ),
  );

  return result.sources
    .filter((source) => citedProvisionIds.has(source.legalProvisionId))
    .map((source) => ({
      actTitle: source.actTitle,
      citationLabel: source.citationLabel,
      text: source.text,
      isNonAuthoritative: source.authorityClass === "non_authoritative",
      isCurrentnessUnproven: source.provenCurrentAsOf === null,
      provenCurrentAsOf: source.provenCurrentAsOf,
    }));
}

export function toExplorerAnswerView(result: LegalAnswerResult): ExplorerAnswerView {
  return {
    status: result.status,
    answer: result.answer,
    conclusions: result.conclusions.map((conclusion) => ({
      statement: conclusion.statement,
      citationLabels: conclusion.support.map((source) => source.citationLabel),
    })),
    alternativePaths: result.alternativePaths.map((path) => ({
      issueLabel: path.issueLabel,
      explanation: path.explanation,
      citationLabels: path.support.map((source) => source.citationLabel),
    })),
    uncertainties: result.uncertainties,
    citedSources: selectCitedSources(result),
    clarificationQuestion: result.clarificationQuestion,
  };
}
