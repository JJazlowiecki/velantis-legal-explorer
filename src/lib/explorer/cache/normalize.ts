import { createHash } from "node:crypto";

/**
 * Deterministic, meaning-preserving normalization used ONLY to compute exact-match identity
 * for the verified legal answer cache (see cache/service.ts). Intentionally minimal — Unicode
 * NFKC, trim, collapse internal whitespace runs to one ASCII space, lowercase — and nothing
 * else: no stemming, no lemmatization, no punctuation stripping, no word removal, no LLM/
 * embedding involvement, no negation handling. "Kto może oddać krew?" and "Kto nie może oddać
 * krwi?" MUST hash differently; only whitespace/case/Unicode-form variants of the exact same
 * question may collide. This is an exact-match cache, never a semantic one.
 */
export function normalizeQuestionForCache(rawQuestion: string): string {
	return rawQuestion.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** SHA-256 of the normalized question — this, not the raw question, is what the cache stores/keys on. */
export function hashNormalizedQuestion(normalizedQuestion: string): string {
	return createHash("sha256").update(normalizedQuestion, "utf8").digest("hex");
}
