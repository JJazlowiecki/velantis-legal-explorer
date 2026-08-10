import { z } from "zod";

import { checkAnswerTargetIndexInRange } from "../issues/schema";

/**
 * The model must cite sources only by the SOURCE_X identifiers the application
 * assigned when packing retrieval evidence — never invent article numbers,
 * legalProvisionIds, or new source identifiers. `buildRawFinalAnswerResponseSchema`
 * additionally rejects any sourceId outside the supplied set.
 */
export const finalAnswerSourceReferenceSchema = z.object({
  sourceId: z.string().min(1),
});

export type FinalAnswerSourceReference = z.infer<typeof finalAnswerSourceReferenceSchema>;

export const finalAnswerConclusionSchema = z.object({
  statement: z.string().min(1),
  /** Every conclusion must be grounded in at least one supplied source — never empty. */
  support: z.array(finalAnswerSourceReferenceSchema).min(1),
  /**
   * 1-based index into the request's answerTargets (issues/schema.ts), or null when this
   * conclusion is genuinely general/not tied to one specific requested aspect (Phase 10:
   * claim/target traceability). Purely descriptive metadata used by answer.ts to order/label
   * the final answer around what the user actually asked — verify.ts/skeptic.ts never read or
   * gate on this field ("need not trust this tag").
   */
  answerTargetIndex: z.number().int().min(1).nullable().optional(),
});

export type FinalAnswerConclusion = z.infer<typeof finalAnswerConclusionSchema>;

export const finalAnswerAlternativePathSchema = z.object({
  issueLabel: z.string().min(1),
  explanation: z.string().min(1),
  /** May be empty: an alternative path can legitimately have no supporting source
   * (e.g. an issue hypothesis the retrieved corpus did not confirm or refute). */
  support: z.array(finalAnswerSourceReferenceSchema),
});

export type FinalAnswerAlternativePath = z.infer<typeof finalAnswerAlternativePathSchema>;

export const rawFinalAnswerResponseSchema = z.object({
  answer: z.string().min(1),
  conclusions: z.array(finalAnswerConclusionSchema),
  alternativePaths: z.array(finalAnswerAlternativePathSchema),
  uncertainties: z.array(z.string().min(1)),
  clarificationQuestion: z.string().min(1).optional(),
});

export type RawFinalAnswerResponse = z.infer<typeof rawFinalAnswerResponseSchema>;

/**
 * Builds a request-scoped schema that additionally rejects any sourceId not present
 * in `validSourceIds` — the citation-integrity boundary. The base shape alone cannot
 * express this because the valid set differs per call (it's the sources actually packed
 * for that request). Also range-checks every conclusion's `answerTargetIndex` against
 * `answerTargetCount` (0 when the request had no answerTargets at all), reusing the exact
 * cross-field-index-range pattern from issues/schema.ts's own answerTargetIndex validation.
 */
export function buildRawFinalAnswerResponseSchema(validSourceIds: ReadonlySet<string>, answerTargetCount = 0) {
  return rawFinalAnswerResponseSchema.superRefine((value, ctx) => {
    const checkRefs = (
      support: FinalAnswerSourceReference[],
      path: (string | number)[],
    ) => {
      support.forEach((ref, index) => {
        if (!validSourceIds.has(ref.sourceId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown source reference "${ref.sourceId}": not among the sources supplied to the model`,
            path: [...path, index, "sourceId"],
          });
        }
      });
    };

    value.conclusions.forEach((conclusion, index) => {
      checkRefs(conclusion.support, ["conclusions", index, "support"]);
      checkAnswerTargetIndexInRange(ctx, conclusion.answerTargetIndex, answerTargetCount, [
        "conclusions",
        index,
        "answerTargetIndex",
      ]);
    });
    value.alternativePaths.forEach((path, index) => checkRefs(path.support, ["alternativePaths", index, "support"]));
  });
}
