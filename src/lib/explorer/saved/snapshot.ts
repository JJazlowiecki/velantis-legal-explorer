import { z } from "zod";

/**
 * Saved item kinds for this milestone. "act" (a saved legal act) is deliberately NOT a kind
 * here — the /explorer/saved UI keeps its "Akty prawne" tab, but it must show an honest empty
 * state until real Legal Acts persistence exists (never fabricate saved-act rows).
 */
export const savedItemKindSchema = z.enum(["answer", "search", "provision"]);

export type SavedItemKind = z.infer<typeof savedItemKindSchema>;

/**
 * Mirrors ExplorerCitedSource (src/lib/explorer/view-model.ts) exactly — the same safe,
 * already-sanitized shape rendered by the live /explorer UI and stored in History. Reused
 * verbatim here (not imported from history/snapshot.ts) so Saved has no compile-time or
 * runtime dependency on History ever staying available — Saved content must remain readable
 * even if History is later deleted by retention or by the user.
 */
export const savedCitedSourceSchema = z.object({
  actTitle: z.string(),
  citationLabel: z.string(),
  text: z.string(),
  isNonAuthoritative: z.boolean(),
  isCurrentnessUnproven: z.boolean(),
});

export const savedConclusionSchema = z.object({
  statement: z.string(),
  citationLabels: z.array(z.string()),
});

export const savedAlternativePathSchema = z.object({
  issueLabel: z.string(),
  explanation: z.string(),
  citationLabels: z.array(z.string()),
});

/**
 * A saved FULL ANSWER — its own independent copy of everything needed to redisplay what the
 * user saved, not merely a pointer to a History row. `query` is duplicated here (also stored
 * in the `query` column) so the snapshot alone is self-sufficient.
 */
export const savedAnswerSnapshotSchema = z.object({
  query: z.string().min(1),
  status: z.enum(["answered", "insufficient_evidence"]),
  answer: z.string(),
  conclusions: z.array(savedConclusionSchema),
  alternativePaths: z.array(savedAlternativePathSchema),
  uncertainties: z.array(z.string()),
  citedSources: z.array(savedCitedSourceSchema),
  clarificationQuestion: z.string().nullable(),
});

export type SavedAnswerSnapshot = z.infer<typeof savedAnswerSnapshotSchema>;

/** A saved SEARCH — just the query, safe to re-run via the existing continue-search mechanism. */
export const savedSearchSnapshotSchema = z.object({
  query: z.string().min(1),
});

export type SavedSearchSnapshot = z.infer<typeof savedSearchSnapshotSchema>;

/** A saved individual PROVISION — the exact cited source card, nothing more. */
export const savedProvisionSnapshotSchema = savedCitedSourceSchema;

export type SavedProvisionSnapshot = z.infer<typeof savedProvisionSnapshotSchema>;

export type SavedSnapshot = SavedAnswerSnapshot | SavedSearchSnapshot | SavedProvisionSnapshot;

/**
 * Picks the right schema for `kind` and validates. Used both when writing (defense before
 * insert) and when reading (a JSONB column is not intrinsically trustworthy just because this
 * service wrote it — see parseSavedItemRow in service.ts). Throws (safeParse-free) so callers
 * writing must handle a genuine validation failure as a real error, while readers use
 * `safeParseSavedSnapshot` below to fail closed instead of throwing.
 */
export function parseSavedSnapshot(kind: SavedItemKind, raw: unknown): SavedSnapshot {
  switch (kind) {
    case "answer":
      return savedAnswerSnapshotSchema.parse(raw);
    case "search":
      return savedSearchSnapshotSchema.parse(raw);
    case "provision":
      return savedProvisionSnapshotSchema.parse(raw);
  }
}

export interface SafeParseSavedSnapshotResult {
  success: boolean;
  data?: SavedSnapshot;
}

/** Read-path variant: never throws, used to fail a malformed persisted row closed (skip it), not crash the request. */
export function safeParseSavedSnapshot(kind: string, raw: unknown): SafeParseSavedSnapshotResult {
  const kindResult = savedItemKindSchema.safeParse(kind);
  if (!kindResult.success) {
    return { success: false };
  }

  switch (kindResult.data) {
    case "answer": {
      const result = savedAnswerSnapshotSchema.safeParse(raw);
      return result.success ? { success: true, data: result.data } : { success: false };
    }
    case "search": {
      const result = savedSearchSnapshotSchema.safeParse(raw);
      return result.success ? { success: true, data: result.data } : { success: false };
    }
    case "provision": {
      const result = savedProvisionSnapshotSchema.safeParse(raw);
      return result.success ? { success: true, data: result.data } : { success: false };
    }
  }
}
