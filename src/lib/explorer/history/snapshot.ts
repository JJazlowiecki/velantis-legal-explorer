import { z } from "zod";

/**
 * The persisted history snapshot is exactly the sanitized `ExplorerAnswerView` shape (see
 * src/lib/explorer/view-model.ts) — the same safe, already-stripped view model the /explorer
 * search UI renders. It never contains raw OpenAI responses, prompts, embeddings, SOURCE_X
 * placeholders, or internal database ids. Validated with Zod both when writing AND when
 * reading: a JSONB column is not intrinsically trustworthy just because we wrote it — a
 * migration, manual edit, or future bug could leave a row that no longer matches this shape.
 */
export const explorerHistoryCitedSourceSchema = z.object({
  actTitle: z.string(),
  citationLabel: z.string(),
  text: z.string(),
  isNonAuthoritative: z.boolean(),
  isCurrentnessUnproven: z.boolean(),
});

export const explorerHistoryConclusionSchema = z.object({
  statement: z.string(),
  citationLabels: z.array(z.string()),
});

export const explorerHistoryAlternativePathSchema = z.object({
  issueLabel: z.string(),
  explanation: z.string(),
  citationLabels: z.array(z.string()),
});

export const explorerHistoryStatusSchema = z.enum(["answered", "insufficient_evidence"]);

export const explorerHistorySnapshotSchema = z.object({
  status: explorerHistoryStatusSchema,
  answer: z.string(),
  conclusions: z.array(explorerHistoryConclusionSchema),
  alternativePaths: z.array(explorerHistoryAlternativePathSchema),
  uncertainties: z.array(z.string()),
  citedSources: z.array(explorerHistoryCitedSourceSchema),
  clarificationQuestion: z.string().nullable(),
});

export type ExplorerHistoryStatus = z.infer<typeof explorerHistoryStatusSchema>;
export type ExplorerHistorySnapshot = z.infer<typeof explorerHistorySnapshotSchema>;

/** corpus_version_ids is stored as a plain JSON array of legalActVersion UUID strings. */
export const explorerHistoryCorpusVersionIdsSchema = z.array(z.uuid());
