import { z } from "zod";

/**
 * Only "direct_support" may survive as a verified conclusion. "partial_support" exists so the
 * model has an honest place to put "the source supports part of this, not the whole claim" —
 * it must NOT be hedged/upgraded into direct_support, and application code treats it exactly
 * like "no_support" (reject). Keeping it distinct from no_support is for prompt honesty and
 * future diagnostics, not because it is ever allowed to survive.
 */
export const conclusionVerdictSchema = z.enum(["direct_support", "partial_support", "no_support"]);

export type ConclusionVerdict = z.infer<typeof conclusionVerdictSchema>;

/**
 * A single alleged exact excerpt from one supplied source. The model may NOT paraphrase —
 * application code (see evidence.ts) deterministically re-checks that `excerpt` occurs
 * verbatim (modulo whitespace normalization) in the source text identified by `sourceId`.
 */
export const conclusionEvidenceSchema = z.object({
  sourceId: z.string().min(1),
  excerpt: z.string().min(1),
});

export type ConclusionEvidence = z.infer<typeof conclusionEvidenceSchema>;

/**
 * A valid SOURCE_X citation is necessary but not sufficient: the verifier checks whether
 * the cited source TEXT actually, substantively supports the exact conclusion statement —
 * not just whether the citation ID is real. `evidence[].sourceId` may only reference the
 * sources that were supplied for that specific conclusion (never other conclusions'
 * sources, never invented ids) — enforced per-conclusion by `buildRawConclusionVerificationResponseSchema`.
 */
export const rawConclusionVerificationResultSchema = z
  .object({
    conclusionIndex: z.number().int().nonnegative(),
    verdict: conclusionVerdictSchema,
    // Diagnostic only — never part of the accept/reject decision, so an empty string here
    // (models sometimes omit reasoning text even when instructed) must not turn a safe,
    // correctly-evidenced verdict into an application-level failure. verdict + evidence are
    // the only fields that gate whether a conclusion survives.
    reason: z.string(),
    evidence: z.array(conclusionEvidenceSchema),
  })
  .superRefine((value, ctx) => {
    if (value.verdict === "direct_support" && value.evidence.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "verdict=direct_support requires at least one evidence entry",
        path: ["evidence"],
      });
    }
  });

export const rawConclusionVerificationResponseSchema = z.object({
  results: z.array(rawConclusionVerificationResultSchema),
});

export type RawConclusionVerificationResult = z.infer<typeof rawConclusionVerificationResultSchema>;
export type RawConclusionVerificationResponse = z.infer<typeof rawConclusionVerificationResponseSchema>;

/**
 * Builds a request-scoped schema requiring exactly one result per supplied conclusionIndex,
 * and rejecting any evidence sourceId not present in the set of sources that were actually
 * supplied to the verifier for that specific conclusion (the generator's own claimed support
 * — never an unrelated retrieved source presented as alternative evidence).
 */
export function buildRawConclusionVerificationResponseSchema(
  allowedSourceIdsByConclusionIndex: ReadonlyMap<number, ReadonlySet<string>>,
) {
  return rawConclusionVerificationResponseSchema.superRefine((value, ctx) => {
    const seenIndices = new Set<number>();

    value.results.forEach((result, index) => {
      const allowed = allowedSourceIdsByConclusionIndex.get(result.conclusionIndex);
      if (!allowed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown conclusionIndex ${result.conclusionIndex}: not among the conclusions supplied for verification`,
          path: ["results", index, "conclusionIndex"],
        });
        return;
      }
      seenIndices.add(result.conclusionIndex);

      result.evidence.forEach((evidenceItem, evidenceIndex) => {
        if (!allowed.has(evidenceItem.sourceId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown source reference "${evidenceItem.sourceId}": not among the sources supplied for conclusion ${result.conclusionIndex}`,
            path: ["results", index, "evidence", evidenceIndex, "sourceId"],
          });
        }
      });
    });

    for (const expectedIndex of allowedSourceIdsByConclusionIndex.keys()) {
      if (!seenIndices.has(expectedIndex)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing verification result for conclusionIndex ${expectedIndex}`,
          path: ["results"],
        });
      }
    }
  });
}
