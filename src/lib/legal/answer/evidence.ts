import type { ConclusionEvidence } from "./verify-schema";

/**
 * Reasonable whitespace normalization only — collapse any run of whitespace (including
 * newlines) to a single space and trim. Deliberately NOT fuzzy: no case-folding, no
 * diacritic stripping, no punctuation removal. The model may not paraphrase; it must quote.
 */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export interface EvidenceValidationFailure {
  sourceId: string;
  excerpt: string;
  reason: "unknown_source" | "excerpt_not_found";
}

/**
 * Deterministically verifies that every evidence excerpt actually occurs verbatim (modulo
 * whitespace normalization) in the text of the source it claims to come from. This is the
 * code-level boundary that a hallucinating or paraphrasing model cannot talk its way past —
 * an LLM claiming "direct_support" is never enough on its own. Returns the list of failures;
 * an empty array means every excerpt validated successfully.
 */
export function validateEvidenceAgainstSources(
  evidence: readonly ConclusionEvidence[],
  sourceTextById: ReadonlyMap<string, string>,
): EvidenceValidationFailure[] {
  const failures: EvidenceValidationFailure[] = [];

  for (const item of evidence) {
    const sourceText = sourceTextById.get(item.sourceId);
    if (sourceText === undefined) {
      failures.push({ sourceId: item.sourceId, excerpt: item.excerpt, reason: "unknown_source" });
      continue;
    }

    const normalizedExcerpt = normalizeWhitespace(item.excerpt);
    const normalizedSource = normalizeWhitespace(sourceText);

    if (normalizedExcerpt.length === 0 || !normalizedSource.includes(normalizedExcerpt)) {
      failures.push({ sourceId: item.sourceId, excerpt: item.excerpt, reason: "excerpt_not_found" });
    }
  }

  return failures;
}
