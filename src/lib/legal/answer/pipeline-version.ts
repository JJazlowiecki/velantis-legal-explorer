/**
 * Explicit, source-controlled compatibility version for the legal answer pipeline (issue
 * detection -> retrieval -> generation -> verification -> skeptic -> recovery). Participates
 * in the verified legal answer cache's identity (see src/lib/explorer/cache/service.ts): bump
 * this whenever a material change to retrieval, prompts, verification, or skeptic behavior
 * could change what a cached answer would have looked like. Old cache rows are never deleted
 * on a bump — they simply stop matching the new identity and become inert, auditable history.
 * Deliberately a hand-maintained string, never derived from a timestamp or build hash, so a
 * bump is always an explicit, reviewable decision.
 */
export const LEGAL_ANSWER_PIPELINE_VERSION = "legal-answer-v4";
