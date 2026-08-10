import { z } from "zod";

import { checkAnswerTargetIndexInAllowedSet } from "../issues/schema";

/**
 * Recovery conclusions require an excerpt on every support entry — unlike the normal
 * generator (schema.ts), which only requires a bare sourceId and defers all evidence
 * production to the strict verifier. Recovery is source-first by construction: the model
 * must ground itself in a literal quote before its claim is even allowed to reach the
 * standard verification pipeline (see evidence.ts / answer.ts's recovery excerpt gate).
 */
export const recoveryEvidenceSchema = z.object({
  sourceId: z.string().min(1),
  excerpt: z.string().min(1),
});

export type RecoveryEvidence = z.infer<typeof recoveryEvidenceSchema>;

export const recoveryConclusionSchema = z.object({
  statement: z.string().min(1),
  support: z.array(recoveryEvidenceSchema).min(1),
  /**
   * SAME request-scoped target semantics as normal generation (see answer/schema.ts's
   * finalAnswerConclusionSchema) — no second target model. 1-based index into the request's
   * answerTargets, or null for a genuinely peripheral/supporting claim. Untrusted model
   * metadata: the verifier/excerpt-validation/skeptic gates below never read or gate on it —
   * it affects only relevance/coverage assembly AFTER a claim has independently survived
   * safety verification (see answer.ts's verifyDraftConclusions, reused unchanged for
   * recovery conclusions too).
   */
  answerTargetIndex: z.number().int().min(1).nullable().optional(),
});

export type RecoveryConclusion = z.infer<typeof recoveryConclusionSchema>;

export const rawRecoveryResponseSchema = z.object({
  conclusions: z.array(recoveryConclusionSchema),
  uncertainties: z.array(z.string().min(1)),
});

export type RawRecoveryResponse = z.infer<typeof rawRecoveryResponseSchema>;

/**
 * Builds a request-scoped schema rejecting any support sourceId outside the sources
 * actually supplied to the recovery pass — the same citation-integrity boundary as
 * buildRawFinalAnswerResponseSchema in schema.ts. Also validates every conclusion's
 * `answerTargetIndex` against `allowedTargetIndexes` — the exact set of target indexes this
 * recovery call was scoped to (the FULL answerTargets set for whole-answer recovery, or only
 * the still-unsupported subset for Part 5's partial recovery — original, un-renumbered
 * indexes either way) — an index outside that set fails schema validation exactly like an
 * unknown sourceId does.
 */
export function buildRawRecoveryResponseSchema(
  validSourceIds: ReadonlySet<string>,
  allowedTargetIndexes: ReadonlySet<number> = new Set(),
) {
  return rawRecoveryResponseSchema.superRefine((value, ctx) => {
    value.conclusions.forEach((conclusion, conclusionIndex) => {
      conclusion.support.forEach((ref, supportIndex) => {
        if (!validSourceIds.has(ref.sourceId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown source reference "${ref.sourceId}": not among the sources supplied to the recovery pass`,
            path: ["conclusions", conclusionIndex, "support", supportIndex, "sourceId"],
          });
        }
      });
      checkAnswerTargetIndexInAllowedSet(ctx, conclusion.answerTargetIndex, allowedTargetIndexes, [
        "conclusions",
        conclusionIndex,
        "answerTargetIndex",
      ]);
    });
  });
}
