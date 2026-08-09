import { z } from "zod";

/**
 * A valid SOURCE_X citation is necessary but not sufficient: the verifier checks whether
 * the cited source TEXT actually, substantively supports the exact conclusion statement —
 * not just whether the citation ID is real. `supportingSourceIds` may only reference the
 * sources that were supplied for that specific conclusion (never other conclusions'
 * sources, never invented ids) — enforced per-conclusion by `buildRawConclusionVerificationResponseSchema`.
 */
export const rawConclusionVerificationResultSchema = z
  .object({
    conclusionIndex: z.number().int().nonnegative(),
    supported: z.boolean(),
    reason: z.string().min(1),
    supportingSourceIds: z.array(z.string().min(1)),
  })
  .superRefine((value, ctx) => {
    if (value.supported && value.supportingSourceIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "supported=true requires at least one supportingSourceIds entry",
        path: ["supportingSourceIds"],
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
 * and rejecting any supportingSourceIds outside the set of sources that were actually
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

      result.supportingSourceIds.forEach((sourceId, sourceIndex) => {
        if (!allowed.has(sourceId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown source reference "${sourceId}": not among the sources supplied for conclusion ${result.conclusionIndex}`,
            path: ["results", index, "supportingSourceIds", sourceIndex],
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
