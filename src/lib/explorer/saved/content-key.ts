import { createHash } from "node:crypto";

import type { SavedItemKind } from "./snapshot";

/**
 * Deterministic content identity used to prevent accidental duplicate saves (e.g. repeated
 * button clicks) — never depends on title text alone. Combined with the DB's
 * (visitor_id, kind, content_key) unique index, saving "the same thing" twice always resolves
 * to the same row instead of creating a new one.
 *
 * Callers build the `seed` per kind (see src/app/explorer/saved/actions.ts):
 * - answer: the source History entry id when known (most precise — re-saving the same
 *   history entry always maps to the same key), otherwise `${query}|${answer text}` when
 *   saving straight from a client payload (History disabled).
 * - search: the normalized query text.
 * - provision: `${actTitle}|${citationLabel}|${text}` — the provision's own content, not any
 *   internal database id (none is ever exposed to the client).
 */
export function buildContentKey(kind: SavedItemKind, seed: string): string {
  const digest = createHash("sha256").update(seed, "utf8").digest("hex");
  return `${kind}:${digest}`;
}

/** Whitespace/case normalization for query-based seeds, so trivial retyping still dedupes. */
export function normalizeQueryForContentKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}
