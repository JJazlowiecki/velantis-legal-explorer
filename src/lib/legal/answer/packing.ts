import type { DeduplicatedRetrievedProvision } from "../issues/investigate";

export interface PackedSource {
  sourceId: string;
  legalProvisionId: string;
  legalActVersionId: string;
  legalActId: string;
  actTitle: string;
  citationLabel: string;
  text: string;
  hierarchy: string[];
  versionKind: string;
  authorityClass: string;
  currentnessStatus: string;
  /**
   * Non-null ONLY when this source's legalActVersionId is a member of the CURRENT-mode corpus
   * run resolved for this exact query (see AnswerLegalProblemOptions.currentCorpusContext) —
   * carries that run's effectiveAsOf date. Currentness is a corpus-run+effectiveAsOf-relative
   * fact, never an immutable-version property: legal_act_versions.currentnessStatus is never
   * read here and never mutated anywhere. Null in historical/test mode, or when the source
   * simply isn't part of the current-corpus context passed for this query (e.g. a different
   * run, or no run at all).
   */
  provenCurrentAsOf: string | null;
  sourceExpressionId: string;
}

export interface CurrentCorpusPackingContext {
  /** The exact set of legalActVersionIds INCLUDED (authoritative_current) in one pinned corpus run. */
  legalActVersionIds: string[];
  effectiveAsOf: string;
}

export interface PackSourcesOptions {
  maxSources?: number;
  /** Omit entirely for historical/test mode — no source is ever treated as proven-current then. */
  currentCorpusContext?: CurrentCorpusPackingContext;
}

const DEFAULT_MAX_SOURCES = 12;

/**
 * Builds the deterministic, bounded source context sent to the final-answer model.
 * Deduplicates by legalProvisionId (defensive — investigateLegalProblem already
 * deduplicates, but this keeps the function safe to call directly), ranks by existing
 * retrieval signal (exact citation matches first, then best fused score) rather than a
 * reranker, and assigns stable SOURCE_1..SOURCE_N identifiers in that order.
 */
export function packSources(
  provisions: DeduplicatedRetrievedProvision[],
  options: PackSourcesOptions = {},
): PackedSource[] {
  const maxSources = options.maxSources ?? DEFAULT_MAX_SOURCES;
  const currentVersionIds = options.currentCorpusContext
    ? new Set(options.currentCorpusContext.legalActVersionIds)
    : null;
  const currentEffectiveAsOf = options.currentCorpusContext?.effectiveAsOf ?? null;

  const byProvisionId = new Map<string, DeduplicatedRetrievedProvision>();
  for (const provision of provisions) {
    const existing = byProvisionId.get(provision.legalProvisionId);
    if (existing) {
      existing.foundBy.push(...provision.foundBy);
    } else {
      byProvisionId.set(provision.legalProvisionId, { ...provision, foundBy: [...provision.foundBy] });
    }
  }

  const ranked = [...byProvisionId.values()].sort((a, b) => {
    const aExact = a.foundBy.some((entry) => entry.isExactCitationMatch);
    const bExact = b.foundBy.some((entry) => entry.isExactCitationMatch);
    if (aExact !== bExact) {
      return aExact ? -1 : 1;
    }

    const aScore = Math.max(...a.foundBy.map((entry) => entry.finalScore));
    const bScore = Math.max(...b.foundBy.map((entry) => entry.finalScore));
    if (aScore !== bScore) {
      return bScore - aScore;
    }

    return a.citationLabel.localeCompare(b.citationLabel);
  });

  return ranked.slice(0, maxSources).map((provision, index) => ({
    sourceId: `SOURCE_${index + 1}`,
    legalProvisionId: provision.legalProvisionId,
    legalActVersionId: provision.legalActVersionId,
    legalActId: provision.legalActId,
    actTitle: provision.actTitle,
    citationLabel: provision.citationLabel,
    text: provision.text,
    hierarchy: provision.hierarchy,
    versionKind: provision.versionKind,
    authorityClass: provision.authorityClass,
    currentnessStatus: provision.currentnessStatus,
    provenCurrentAsOf:
      currentVersionIds && currentVersionIds.has(provision.legalActVersionId) ? currentEffectiveAsOf : null,
    sourceExpressionId: provision.sourceExpressionId,
  }));
}
