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

export const legalIssueHypothesisSchema = z.object({
  label: z.string().min(1),
  likelihood: legalIssueLikelihoodSchema,
  rationale: z.string().min(1),
  retrievalQueries: z.array(z.string().min(1)).min(1),
});

export type LegalIssueHypothesis = z.infer<typeof legalIssueHypothesisSchema>;

export const legalIssueDetectionResultSchema = z.object({
  summary: z.string().min(1),
  // Empty is a LEGITIMATE result: a clearly non-legal prompt (weather, a poem request,
  // arithmetic, ...) has zero plausible legal issues, and the model correctly says so rather
  // than fabricating one to satisfy a shape requirement. Each individual issue, when present,
  // is still fully validated (see legalIssueHypothesisSchema) — this only relaxes the count.
  issues: z.array(legalIssueHypothesisSchema),
  clarificationQuestion: z.string().min(1).optional(),
});

export type LegalIssueDetectionResult = z.infer<typeof legalIssueDetectionResultSchema>;
