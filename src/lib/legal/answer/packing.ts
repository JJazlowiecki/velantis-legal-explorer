import type { AnswerTargetView, DeduplicatedRetrievedProvision } from "../issues/investigate";
import { rankCandidates } from "./candidate-ranking";

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
  /** 1-based answerTarget indexes (see issues/schema.ts) this source was reserved for in PASS 1
   * (see packSources), if any — empty for a PASS-2 (global-fill) source. Purely informational
   * provenance for the debug trace / final-answer prompt; never gates verification. */
  reservedForAnswerTargetIndexes: number[];
}

export interface CurrentCorpusPackingContext {
  /** The exact set of legalActVersionIds INCLUDED (authoritative_current) in one pinned corpus run. */
  legalActVersionIds: string[];
  effectiveAsOf: string;
}

export interface PackSourcesOptions {
  /** Hard ceiling on number of packed sources. The proven database-rights defect was ranking,
   * not this count — kept at its historical default. */
  maxSources?: number;
  /** Hard ceiling on total packed source TEXT length (approximate token-budget proxy; no
   * external tokenizer). Short sources allow more entries; long sources consume more of the
   * budget. Applies across BOTH pass 1 (target reservation) and pass 2 (global fill). */
  maxPackedCharacters?: number;
  /** Requested aspects from issue detection (see issues/schema.ts's answerTargetSchema) — drives
   * PASS 1 reservation below. Omit (or empty) to fall back to pure global-ranked packing
   * (equivalent to the pre-Phase-6 behavior). */
  answerTargets?: AnswerTargetView[];
  /** Omit entirely for historical/test mode — no source is ever treated as proven-current then. */
  currentCorpusContext?: CurrentCorpusPackingContext;
}

const DEFAULT_MAX_SOURCES = 12;
const DEFAULT_MAX_PACKED_CHARACTERS = 12_000;

function dedupeByProvisionId(provisions: DeduplicatedRetrievedProvision[]): DeduplicatedRetrievedProvision[] {
  const byProvisionId = new Map<string, DeduplicatedRetrievedProvision>();
  for (const provision of provisions) {
    const existing = byProvisionId.get(provision.legalProvisionId);
    if (existing) {
      existing.foundBy.push(...provision.foundBy);
    } else {
      byProvisionId.set(provision.legalProvisionId, { ...provision, foundBy: [...provision.foundBy] });
    }
  }
  return [...byProvisionId.values()];
}

function toPackedSource(
  provision: DeduplicatedRetrievedProvision,
  sourceId: string,
  currentVersionIds: ReadonlySet<string> | null,
  currentEffectiveAsOf: string | null,
  reservedForAnswerTargetIndexes: number[],
): PackedSource {
  return {
    sourceId,
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
    reservedForAnswerTargetIndexes,
  };
}

/**
 * Builds the deterministic, bounded source context sent to the final-answer model.
 *
 * Two-pass, target-aware selection (Phase 6) — replaces the previous pure "top N flat fused
 * candidates" behavior, which is what silently dropped art. 6 ust. 1 (the exclusive-right
 * provision directly answering the database-rights question) below a fixed maxSources=12 cut
 * even though it was successfully retrieved:
 *
 *   PASS 1 (reserve): for each answerTarget, if any retrieved candidate was found via a
 *   most_likely issue for that target, reserve its single best-ranked (candidate-ranking.ts)
 *   candidate. No fabrication: only real, already-quality-gated retrieval results are ever
 *   reserved (the vector-similarity floor already applied upstream in rank.ts/service.ts is
 *   never lowered or bypassed here). A target with no qualifying candidate is simply skipped —
 *   coverage is never forced with weak/irrelevant evidence.
 *
 *   PASS 2 (fill): remaining budget (both maxSources and maxPackedCharacters) filled by global
 *   candidate-ranking.ts order, excluding sources already reserved in pass 1.
 *
 * Deduplicates by legalProvisionId (defensive — investigateLegalProblem already deduplicates,
 * but this keeps the function safe to call directly), and assigns stable SOURCE_1..SOURCE_N
 * identifiers in final pack order (reserved sources first, in answerTarget order; then
 * pass-2 fill order) so downstream citations are stable and traceable.
 */
export function packSources(
  provisions: DeduplicatedRetrievedProvision[],
  options: PackSourcesOptions = {},
): PackedSource[] {
  const maxSources = options.maxSources ?? DEFAULT_MAX_SOURCES;
  const maxPackedCharacters = options.maxPackedCharacters ?? DEFAULT_MAX_PACKED_CHARACTERS;
  const answerTargets = options.answerTargets ?? [];
  const currentVersionIds = options.currentCorpusContext
    ? new Set(options.currentCorpusContext.legalActVersionIds)
    : null;
  const currentEffectiveAsOf = options.currentCorpusContext?.effectiveAsOf ?? null;

  const deduped = dedupeByProvisionId(provisions);
  const ranked = rankCandidates(deduped);

  const packed: { provision: DeduplicatedRetrievedProvision; reservedForAnswerTargetIndexes: number[] }[] = [];
  const reservedProvisionIds = new Set<string>();
  let usedCharacters = 0;
  let sourceCount = 0;

  function tryAdd(provision: DeduplicatedRetrievedProvision, reservedFor: number[]): boolean {
    if (sourceCount >= maxSources) {
      return false;
    }
    if (usedCharacters + provision.text.length > maxPackedCharacters && sourceCount > 0) {
      // Never let a single very long source starve an otherwise-empty pack: the first source
      // is always admitted even if it alone exceeds the character budget.
      return false;
    }
    packed.push({ provision, reservedForAnswerTargetIndexes: reservedFor });
    reservedProvisionIds.add(provision.legalProvisionId);
    usedCharacters += provision.text.length;
    sourceCount += 1;
    return true;
  }

  // PASS 1: reserve the best most_likely-found candidate per answerTarget.
  for (const target of answerTargets) {
    const qualifying = ranked.filter(
      (candidate) =>
        !reservedProvisionIds.has(candidate.legalProvisionId) &&
        candidate.foundBy.some(
          (entry) => entry.issueLikelihood === "most_likely" && entry.answerTargetIndex === target.index,
        ),
    );
    const best = qualifying[0];
    if (best) {
      tryAdd(best, [target.index]);
    }
  }

  // PASS 2: fill remaining budget in global rank order.
  for (const candidate of ranked) {
    if (reservedProvisionIds.has(candidate.legalProvisionId)) {
      continue;
    }
    if (!tryAdd(candidate, [])) {
      // maxSources reached: nothing later in rank order could still fit either, stop entirely.
      // A miss caused only by the character budget is NOT fatal to the whole pass — a later,
      // shorter candidate may still fit under the remaining budget, so the loop continues
      // (greedy best-fit by rank order, not a knapsack search).
      if (sourceCount >= maxSources) {
        break;
      }
    }
  }

  return packed.map((entry, index) =>
    toPackedSource(
      entry.provision,
      `SOURCE_${index + 1}`,
      currentVersionIds,
      currentEffectiveAsOf,
      entry.reservedForAnswerTargetIndexes,
    ),
  );
}
