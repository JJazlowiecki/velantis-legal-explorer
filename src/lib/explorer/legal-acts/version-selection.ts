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
  /**
   * Immutable-instance provenance: set ONLY for a real, announcement-backed consolidated (tj)
   * version (see consolidated-ingest.ts). Null for ogl/uj, and null for the legacy
   * pre-announcement-model bare "tj" reachability alias — that alias must never be treated as
   * though it were a real consolidated snapshot once a real one exists.
   */
  sourceAnnouncementLegalActId: string | null;
  /** Official "data stanu prawnego" of an announcement-backed version, when known. Display/tie-break only — never implies currentness. */
  legalStateDate: string | null;
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
 * Picks ONE deterministic representative among versions that share a `versionKind`. For
 * `versionKind === "consolidated"` this now has to handle a real scenario: multiple IMMUTABLE
 * announcement-backed tj versions coexisting for one act (see feature/current-law-corpus Phase
 * 1), plus possibly a legacy, non-announcement-backed "tj" alias with no real content.
 *
 * Rule: if any real (announcement-backed) candidate exists, the legacy alias is EXCLUDED from
 * consideration entirely — it must never outrank or stand in for a real immutable snapshot, even
 * if the alias happens to have structure (it shouldn't, by construction of the ingestion
 * pipelines, but this doesn't rely on that). Among real candidates (or, if none exist, among
 * whatever's left), prefer: structured over unstructured, then the most recent official
 * `legalStateDate`, then id as a final stable tie-break. A caller-visible warning is added
 * whenever more than one real candidate existed, so "a choice was made among several real
 * versions" is never silent.
 */
function pickRepresentative(
  candidates: VersionSelectionInput[],
): { representative: VersionSelectionInput; warning: string | null } | null {
  if (candidates.length === 0) {
    return null;
  }

  const real = candidates.filter((v) => v.sourceAnnouncementLegalActId !== null);
  const pool = real.length > 0 ? real : candidates;

  const sorted = [...pool].sort((a, b) => {
    const structureDiff = (b.hasStructure ? 1 : 0) - (a.hasStructure ? 1 : 0);
    if (structureDiff !== 0) return structureDiff;

    const officialDiff =
      (["ogl", "tj", "uj"].includes(b.sourceExpressionId) ? 1 : 0) -
      (["ogl", "tj", "uj"].includes(a.sourceExpressionId) ? 1 : 0);
    if (officialDiff !== 0) return officialDiff;

    const dateDiff = (b.legalStateDate ?? "").localeCompare(a.legalStateDate ?? "");
    if (dateDiff !== 0) return dateDiff;

    return a.id.localeCompare(b.id);
  });

  const representative = sorted[0];
  const warning =
    real.length > 1
      ? `Ten akt ma ${real.length} niezależne, oficjalne wersje skonsolidowane (tj) — wyświetlono wersję wg stanu prawnego na dzień: ${representative.legalStateDate ?? "nieznana"}.`
      : null;

  return { representative, warning };
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

  const byKind = new Map<LegalActVersionKind, VersionSelectionInput[]>();
  for (const version of versions) {
    const list = byKind.get(version.versionKind) ?? [];
    list.push(version);
    byKind.set(version.versionKind, list);
  }

  const warnings: string[] = [];
  const representatives: VersionSelectionInput[] = [];
  for (const candidates of byKind.values()) {
    const picked = pickRepresentative(candidates);
    if (!picked) continue;
    representatives.push(picked.representative);
    if (picked.warning) warnings.push(picked.warning);
  }

  const candidates: ExpressionCandidate[] = representatives.map((version) => ({
    sourceExpressionId: version.sourceExpressionId,
    versionKind: version.versionKind,
    canonicalEliUri: version.canonicalEliUri,
    authorityClass: version.authorityClass,
    nonAuthoritative: version.nonAuthoritative,
    currentnessStatus: version.currentnessStatus,
  }));

  const selection = chooseExpressionSelection(candidates);
  warnings.push(...selection.warnings);

  // representatives has at most one entry per versionKind (see byKind above), and our
  // vocabulary maps each versionKind to exactly one sourceExpressionId (ogl/tj/uj), so matching
  // by sourceExpressionId here always recovers the single correct representative.
  const authoritativeRepresentative = selection.authoritativeVersion
    ? representatives.find((v) => v.sourceExpressionId === selection.authoritativeVersion!.sourceExpressionId)
    : undefined;
  const retrievalRepresentative = selection.retrievalVersion
    ? representatives.find((v) => v.sourceExpressionId === selection.retrievalVersion!.sourceExpressionId)
    : undefined;

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
