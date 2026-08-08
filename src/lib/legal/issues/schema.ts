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
  issues: z.array(legalIssueHypothesisSchema).min(1),
  clarificationQuestion: z.string().min(1).optional(),
});

export type LegalIssueDetectionResult = z.infer<typeof legalIssueDetectionResultSchema>;
