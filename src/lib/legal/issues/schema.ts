import { z } from "zod";

/**
 * Qualitative only — never a fabricated numeric confidence score. These are
 * retrieval hypotheses, not legal conclusions.
 */
export const legalIssueLikelihoodSchema = z.enum([
  "most_likely",
  "possible",
  "needs_more_information",
]);

export type LegalIssueLikelihood = z.infer<typeof legalIssueLikelihoodSchema>;

/**
 * A concrete, concise, user-worded aspect the user is actually asking to have answered
 * (e.g. "jakie prawa ma producent bazy danych") — NOT a legal-domain hypothesis and NOT a
 * fixed ontology (rights/conditions/damages/...). `answerTargets` is a small (<=4) bounded
 * list; every cross-reference to a target elsewhere in this schema is a 1-based INDEX into
 * this array (never a model-generated string id) — the same request-scoped-id convention
 * already used for SOURCE_X/conclusionIndex elsewhere in the answer pipeline, chosen here
 * because it lets the array be assigned/validated without asking the model to invent and
 * consistently reuse a stable identifier.
 */
export const answerTargetSchema = z.object({
  text: z.string().min(1),
});

export type AnswerTarget = z.infer<typeof answerTargetSchema>;

export const retrievalQueryPlanSchema = z.object({
  query: z.string().min(1),
  /** 1-based index into the top-level `answerTargets` array — which requested aspect this
   * specific query is trying to retrieve evidence for. */
  answerTargetIndex: z.number().int().min(1),
});

export type RetrievalQueryPlan = z.infer<typeof retrievalQueryPlanSchema>;

export const legalIssueHypothesisSchema = z.object({
  label: z.string().min(1),
  likelihood: legalIssueLikelihoodSchema,
  rationale: z.string().min(1),
  /** 1-based indexes into `answerTargets` this issue is relevant to. Every issue must serve
   * at least one requested target — an issue that answers nothing the user asked is exactly
   * the peripheral-hypothesis failure mode this field exists to prevent. */
  answerTargetIndexes: z.array(z.number().int().min(1)).min(1),
  retrievalQueries: z.array(retrievalQueryPlanSchema).min(1),
});

export type LegalIssueHypothesis = z.infer<typeof legalIssueHypothesisSchema>;

const rawLegalIssueDetectionResultSchema = z.object({
  summary: z.string().min(1),
  // 1-4 concise, user-worded requested aspects. Empty is legitimate only when there are no
  // issues at all (non-legal input) — see the cross-field refine below.
  answerTargets: z.array(answerTargetSchema).max(4),
  // Empty is a LEGITIMATE result: a clearly non-legal prompt (weather, a poem request,
  // arithmetic, ...) has zero plausible legal issues, and the model correctly says so rather
  // than fabricating one to satisfy a shape requirement. Each individual issue, when present,
  // is still fully validated (see legalIssueHypothesisSchema) — this only relaxes the count.
  issues: z.array(legalIssueHypothesisSchema),
  clarificationQuestion: z.string().min(1).optional(),
});

/**
 * Cross-field validation the strict OpenAI JSON Schema cannot express (no way to bound an
 * integer by another field's runtime-computed array length): every `answerTargetIndex` /
 * `answerTargetIndexes` entry anywhere in the response must reference a real position in
 * `answerTargets`, and whenever at least one issue was detected, at least one answer target
 * must exist for it to point at. Mirrors the existing `retrievalQueries.min(1)` pattern of
 * "strict schema expresses the shape, Zod enforces the request-scoped invariant."
 */
export const legalIssueDetectionResultSchema = rawLegalIssueDetectionResultSchema.superRefine((value, ctx) => {
  if (value.issues.length > 0 && value.answerTargets.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "answerTargets must be non-empty whenever at least one issue was detected",
      path: ["answerTargets"],
    });
  }

  const maxIndex = value.answerTargets.length;

  value.issues.forEach((issue, issueIndex) => {
    issue.answerTargetIndexes.forEach((targetIndex, i) => {
      if (targetIndex > maxIndex) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `answerTargetIndex ${targetIndex} is out of range (answerTargets has ${maxIndex} entries)`,
          path: ["issues", issueIndex, "answerTargetIndexes", i],
        });
      }
    });

    issue.retrievalQueries.forEach((query, queryIndex) => {
      if (query.answerTargetIndex > maxIndex) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `answerTargetIndex ${query.answerTargetIndex} is out of range (answerTargets has ${maxIndex} entries)`,
          path: ["issues", issueIndex, "retrievalQueries", queryIndex, "answerTargetIndex"],
        });
      }
    });
  });
});

export type LegalIssueDetectionResult = z.infer<typeof rawLegalIssueDetectionResultSchema>;

/**
 * Reusable request-scoped "index into a bounded array" range check — the same shape of
 * validation needed here (answerTargetIndex <= answerTargets.length) is needed again in
 * answer/schema.ts for `finalAnswerConclusionSchema.answerTargetIndex`. Kept generic and
 * side-effect-free (adds issues via the caller's ctx) rather than duplicating the loop body.
 */
export function checkAnswerTargetIndexInRange(
  ctx: z.RefinementCtx,
  targetIndex: number | null | undefined,
  maxIndex: number,
  path: (string | number)[],
): void {
  if (targetIndex === null || targetIndex === undefined) {
    return;
  }
  if (targetIndex < 1 || targetIndex > maxIndex) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `answerTargetIndex ${targetIndex} is out of range (answerTargets has ${maxIndex} entries)`,
      path,
    });
  }
}
