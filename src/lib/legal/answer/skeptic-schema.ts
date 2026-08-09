import { z } from "zod";

/**
 * Stage 2 (skeptical pass) result for one conclusion that already passed stage 1
 * (direct_support + validated verbatim evidence). The skeptic does not re-decide support;
 * its only question is whether the conclusion, as stated, contains any legal proposition
 * that goes beyond what the confirmed evidence actually establishes.
 */
export const skepticResultSchema = z.object({
  conclusionIndex: z.number().int().nonnegative(),
  hasUnsupportedLeap: z.boolean(),
  // Diagnostic only — never part of the accept/reject decision, so an empty string here must
  // not turn a safe verdict into an application-level failure. hasUnsupportedLeap alone gates
  // survival.
  reason: z.string(),
});

export type SkepticResult = z.infer<typeof skepticResultSchema>;

export const skepticResponseSchema = z.object({
  results: z.array(skepticResultSchema),
});

export type SkepticResponse = z.infer<typeof skepticResponseSchema>;

/**
 * Builds a request-scoped schema requiring exactly one result per supplied conclusionIndex —
 * mirrors the same defense-in-depth pattern as verify-schema.ts's response schema builder.
 */
export function buildSkepticResponseSchema(expectedConclusionIndices: ReadonlySet<number>) {
  return skepticResponseSchema.superRefine((value, ctx) => {
    const seenIndices = new Set<number>();

    value.results.forEach((result, index) => {
      if (!expectedConclusionIndices.has(result.conclusionIndex)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown conclusionIndex ${result.conclusionIndex}: not among the conclusions supplied for skeptical review`,
          path: ["results", index, "conclusionIndex"],
        });
        return;
      }
      seenIndices.add(result.conclusionIndex);
    });

    for (const expectedIndex of expectedConclusionIndices) {
      if (!seenIndices.has(expectedIndex)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing skeptical review result for conclusionIndex ${expectedIndex}`,
          path: ["results"],
        });
      }
    }
  });
}
