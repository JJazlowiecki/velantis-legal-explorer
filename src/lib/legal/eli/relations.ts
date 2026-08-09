import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema";
import { legalActRelations, legalActs } from "../../../db/schema";
import type { EliActReferences } from "./schema";
import { ELI_SOURCE } from "./schema";

/**
 * OUR stable internal relation vocabulary — decoupled from the Polish `sourceRelationType`
 * labels ELI actually returns, so an upstream wording change can never silently break
 * classification logic that switches on this value. `unrecognized` is the deliberate fail-closed
 * bucket for any label not in {@link KNOWN_RELATION_TYPE_LABELS}: the relation is still stored
 * (never dropped, never crashes ingestion) with its original label preserved for audit, but
 * nothing downstream may treat it as meaningful.
 */
export type InternalRelationType =
  | "consolidated_text_announcement"
  | "consolidated_text_for_act"
  | "post_consolidated_amendment"
  | "amending_act"
  | "constitutional_tribunal"
  | "correction"
  | "unrecognized";

/** Real ELI `/references` Polish relation labels this pipeline has observed and give semantic meaning to. */
const KNOWN_RELATION_TYPE_LABELS: Record<string, InternalRelationType> = {
  "Inf. o tekście jednolitym": "consolidated_text_announcement",
  "Tekst jednolity dla aktu": "consolidated_text_for_act",
  "Nowelizacje po tekście jednolitym": "post_consolidated_amendment",
  "Akty zmieniające": "amending_act",
  "Orzeczenie TK": "constitutional_tribunal",
  Sprostowanie: "correction",
};

export function classifyRelationType(sourceRelationType: string): InternalRelationType {
  return KNOWN_RELATION_TYPE_LABELS[sourceRelationType] ?? "unrecognized";
}

export interface RelationDraft {
  relationType: InternalRelationType;
  sourceRelationType: string;
  relatedSourceId: string;
}

/**
 * Flattens the raw `/references` payload into normalized, deduplicated relation drafts. Multiple
 * raw entries that happen to collapse onto the same (relationType, relatedSourceId) pair (e.g.
 * two different unrecognized labels both pointing at the same related act) are deduplicated,
 * keeping the first-seen source label — this matches the DB's
 * `legal_act_relations_identity_uidx` unique constraint exactly, so building drafts this way can
 * never attempt to violate it.
 */
export function mapEliReferencesToRelationDrafts(references: EliActReferences): RelationDraft[] {
  const byIdentity = new Map<string, RelationDraft>();

  for (const [sourceRelationType, entries] of Object.entries(references)) {
    const relationType = classifyRelationType(sourceRelationType);

    for (const entry of entries) {
      const relatedSourceId = `${entry.act.publisher}/${entry.act.year}/${entry.act.pos}`;
      const identityKey = `${relationType} ${relatedSourceId}`;

      if (!byIdentity.has(identityKey)) {
        byIdentity.set(identityKey, { relationType, sourceRelationType, relatedSourceId });
      }
    }
  }

  return [...byIdentity.values()];
}

export interface SyncLegalActRelationsInput {
  db: PostgresJsDatabase<typeof schema>;
  legalActId: string;
  /**
   * The relation graph from the LATEST SUCCESSFUL ELI `/references` fetch. Callers must only
   * invoke this function when the fetch actually succeeded — a failed/errored fetch must never
   * reach this function at all (see ingest.ts, which skips the call entirely on fetch failure),
   * since any relation absent from `references` is treated as "confirmed gone" and deactivated.
   */
  references: EliActReferences;
  now?: Date;
}

export interface SyncLegalActRelationsResult {
  inserted: number;
  /** Existing row touched this run: either still active (refreshed) or reactivated from inactive. */
  updated: number;
  /** Previously-active row absent from this run's payload — marked inactive, never deleted. */
  deactivated: number;
  resolved: number;
}

/**
 * Snapshot-semantics upsert of the normalized relation graph for one act, atomic per act (single
 * transaction): every relation present in `references` becomes/stays `isActive: true` with
 * `refreshedAt` bumped; every previously-active relation for this act NOT present in `references`
 * is marked `isActive: false` — the row and its history (discoveredAt, prior refreshedAt) are
 * NEVER deleted, so a relation that later reappears reactivates the SAME identity rather than
 * creating a duplicate. This means an empty (but successfully-fetched) `references` payload
 * legitimately deactivates every previously-active relation for the act — that is correct: it
 * means ELI itself reported nothing, not that the fetch failed (a failed fetch must never reach
 * this function — see the type-level note on `references` above).
 *
 * Resolution of `relatedLegalActId` is attempted on every run (insert, refresh, AND reactivate):
 * if the related act has since been ingested into `legal_acts` under the same ELI source/
 * sourceId, the FK is attached; if not, `relatedLegalActId` stays/becomes null and the relation
 * remains fully auditable via `relatedSourceId` alone (fail-closed for classification, by design).
 *
 * Future current-law classification must query `WHERE is_active` — an inactive row is historical
 * provenance, not current evidence.
 */
export async function syncLegalActRelations(
  input: SyncLegalActRelationsInput,
): Promise<SyncLegalActRelationsResult> {
  const { db, legalActId } = input;
  const now = input.now ?? new Date();
  const drafts = mapEliReferencesToRelationDrafts(input.references);

  const result: SyncLegalActRelationsResult = { inserted: 0, updated: 0, deactivated: 0, resolved: 0 };

  const relatedSourceIds = [...new Set(drafts.map((draft) => draft.relatedSourceId))];
  const resolvedActs =
    relatedSourceIds.length > 0
      ? await db
          .select({ id: legalActs.id, sourceId: legalActs.sourceId })
          .from(legalActs)
          .where(and(eq(legalActs.source, ELI_SOURCE), inArray(legalActs.sourceId, relatedSourceIds)))
      : [];
  const resolvedIdBySourceId = new Map(resolvedActs.map((act) => [act.sourceId, act.id]));

  await db.transaction(async (tx) => {
    const existingRelations = await tx
      .select()
      .from(legalActRelations)
      .where(eq(legalActRelations.legalActId, legalActId));
    const existingByIdentity = new Map(
      existingRelations.map((relation) => [`${relation.relationType} ${relation.relatedSourceId}`, relation]),
    );
    const seenIdentities = new Set<string>();

    for (const draft of drafts) {
      const identityKey = `${draft.relationType} ${draft.relatedSourceId}`;
      seenIdentities.add(identityKey);
      const relatedLegalActId = resolvedIdBySourceId.get(draft.relatedSourceId) ?? null;
      const existing = existingByIdentity.get(identityKey);

      if (relatedLegalActId && (!existing || !existing.relatedLegalActId)) {
        result.resolved += 1;
      }

      if (!existing) {
        await tx.insert(legalActRelations).values({
          legalActId,
          relationType: draft.relationType,
          sourceRelationType: draft.sourceRelationType,
          relatedSourceId: draft.relatedSourceId,
          relatedLegalActId,
          isActive: true,
          discoveredAt: now,
          refreshedAt: now,
        });
        result.inserted += 1;
        continue;
      }

      await tx
        .update(legalActRelations)
        .set({
          sourceRelationType: draft.sourceRelationType,
          relatedLegalActId,
          isActive: true,
          refreshedAt: now,
        })
        .where(eq(legalActRelations.id, existing.id));
      result.updated += 1;
    }

    const toDeactivate = existingRelations.filter(
      (relation) => relation.isActive && !seenIdentities.has(`${relation.relationType} ${relation.relatedSourceId}`),
    );
    if (toDeactivate.length > 0) {
      await tx
        .update(legalActRelations)
        .set({ isActive: false })
        .where(
          inArray(
            legalActRelations.id,
            toDeactivate.map((relation) => relation.id),
          ),
        );
      result.deactivated = toDeactivate.length;
    }
  });

  return result;
}
