import { chooseExpressionSelection, type ExpressionCandidate } from "@/lib/legal/eli/expressions";
import type { CurrentnessStatus, ExpressionAuthorityClass, LegalActVersionKind } from "@/lib/legal/eli/schema";

export interface VersionSelectionInput {
  id: string;
  sourceExpressionId: string;
  versionKind: LegalActVersionKind;
  canonicalEliUri: string | null;
  authorityClass: ExpressionAuthorityClass;
  nonAuthoritative: boolean;
  currentnessStatus: CurrentnessStatus;
  fetchedAt: Date;
  hasStructure: boolean;
}

export interface VersionSelectionResult {
  /** The version the detail page should render initially. Null only when there are no versions at all. */
  defaultVersionId: string | null;
  /** Per existing eli/expressions.ts semantics: the version an authoritative citation should prefer (TJ, else OGL). Never UJ. */
  authoritativeVersionId: string | null;
  /** Per existing eli/expressions.ts semantics: the version retrieval/readability should prefer (UJ, else TJ, else OGL). */
  retrievalVersionId: string | null;
  warnings: string[];
}

/**
 * Picks a deterministic default display version for the act detail page, per milestone spec
 * item 11: prefer an authoritative version with usable structure; otherwise fall back to
 * another structured version; never silently equate "preferred for retrieval" with
 * "authoritative current law". Reuses the existing chooseExpressionSelection semantics
 * (src/lib/legal/eli/expressions.ts) rather than introducing a second, conflicting
 * version-preference algorithm — that function already encodes "UJ preferred for retrieval but
 * never authoritative; TJ preferred as authoritative, OGL as fallback".
 */
export function chooseDisplayVersion(versions: ReadonlyArray<VersionSelectionInput>): VersionSelectionResult {
  if (versions.length === 0) {
    return { defaultVersionId: null, authoritativeVersionId: null, retrievalVersionId: null, warnings: [] };
  }

  // chooseExpressionSelection picks at most one candidate per versionKind (via .find), so when
  // an act has more than one version of the same kind (observed in real data — see ingestion
  // history), pick a single deterministic representative per kind first: prefer one that has
  // structured provisions, then the officially-recognized expression id (ogl/tj/uj) over an
  // ad-hoc one, then the earliest fetchedAt.
  const byKind = new Map<LegalActVersionKind, VersionSelectionInput>();
  for (const version of [...versions].sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime())) {
    const existing = byKind.get(version.versionKind);
    if (!existing) {
      byKind.set(version.versionKind, version);
      continue;
    }
    const existingIsOfficial = ["ogl", "tj", "uj"].includes(existing.sourceExpressionId);
    const candidateIsOfficial = ["ogl", "tj", "uj"].includes(version.sourceExpressionId);
    const existingScore = (existing.hasStructure ? 2 : 0) + (existingIsOfficial ? 1 : 0);
    const candidateScore = (version.hasStructure ? 2 : 0) + (candidateIsOfficial ? 1 : 0);
    if (candidateScore > existingScore) {
      byKind.set(version.versionKind, version);
    }
  }

  const representatives = [...byKind.values()];
  const candidates: ExpressionCandidate[] = representatives.map((version) => ({
    sourceExpressionId: version.sourceExpressionId,
    versionKind: version.versionKind,
    canonicalEliUri: version.canonicalEliUri,
    authorityClass: version.authorityClass,
    nonAuthoritative: version.nonAuthoritative,
    currentnessStatus: version.currentnessStatus,
  }));

  const selection = chooseExpressionSelection(candidates);

  const representativeByExpressionId = new Map(representatives.map((version) => [version.sourceExpressionId, version]));
  const authoritativeRepresentative = selection.authoritativeVersion
    ? representativeByExpressionId.get(selection.authoritativeVersion.sourceExpressionId)
    : undefined;
  const retrievalRepresentative = selection.retrievalVersion
    ? representativeByExpressionId.get(selection.retrievalVersion.sourceExpressionId)
    : undefined;

  const warnings = [...selection.warnings];

  // Prefer, in order: the authoritative representative if it has structure, then the
  // retrieval representative if it has structure, then ANY version with structure
  // (authoritative before non-authoritative, consolidated before promulgated before unified,
  // then id for a stable tie-break), then finally just the authoritative/retrieval/first
  // version for metadata-only display when nothing has structure at all.
  const kindPriority: Record<LegalActVersionKind, number> = { consolidated: 0, promulgated: 1, unified: 2, unknown: 3 };
  const anyStructured = [...versions]
    .filter((version) => version.hasStructure)
    .sort((a, b) => {
      const authorityDiff = (a.authorityClass === "authoritative" ? 0 : 1) - (b.authorityClass === "authoritative" ? 0 : 1);
      if (authorityDiff !== 0) return authorityDiff;
      const kindDiff = kindPriority[a.versionKind] - kindPriority[b.versionKind];
      if (kindDiff !== 0) return kindDiff;
      return a.id.localeCompare(b.id);
    })[0];

  let defaultVersionId: string | null;
  if (authoritativeRepresentative?.hasStructure) {
    defaultVersionId = authoritativeRepresentative.id;
  } else if (retrievalRepresentative?.hasStructure) {
    defaultVersionId = retrievalRepresentative.id;
    warnings.push("Brak dostępnej struktury dla wersji autorytatywnej — wyświetlono inną dostępną wersję ze strukturą.");
  } else if (anyStructured) {
    defaultVersionId = anyStructured.id;
    warnings.push("Brak dostępnej struktury dla wersji preferowanej — wyświetlono inną dostępną wersję ze strukturą.");
  } else {
    defaultVersionId = authoritativeRepresentative?.id ?? retrievalRepresentative?.id ?? versions[0].id;
    warnings.push("Brak dostępnej struktury aktu dla żadnej znanej wersji.");
  }

  return {
    defaultVersionId,
    authoritativeVersionId: authoritativeRepresentative?.id ?? null,
    retrievalVersionId: retrievalRepresentative?.id ?? null,
    warnings,
  };
}
