import { eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema";
import { legalActVersions, legalActs, legalProvisions } from "../../../db/schema";
import { isSearchableProvision } from "./documents";

export interface HydratedProvision {
  legalProvisionId: string;
  legalActVersionId: string;
  legalActId: string;
  actTitle: string;
  citationLabel: string;
  text: string;
  hierarchy: string[];
  versionKind: string;
  authorityClass: string;
  currentnessStatus: string;
  sourceExpressionId: string;
}

interface AncestorRow {
  leafId: string;
  heading: string | null;
  citationLabel: string;
  text: string;
  provisionType: string;
  depth: number;
}

/**
 * A structurally proven ancestor (via parentProvisionId, never a sibling or unrelated
 * neighbor) contributes its own operative text to a descendant's context ONLY when that text
 * carries independent meaning — i.e. it would itself pass isSearchableProvision, the exact
 * same test used to decide what gets indexed as evidence. This is deliberately the same bar:
 * a systematic container (division/chapter/...) or a heading-duplicate article never gets its
 * "text" surfaced here, exactly as it's never surfaced as retrievable evidence elsewhere. This
 * is context only — it never adds a new citable source, never changes which provisions are
 * retrieved, and never bypasses excerpt/source verification.
 */
function formatAncestorContext(row: Pick<AncestorRow, "heading" | "citationLabel" | "text" | "provisionType">): string {
  if (isSearchableProvision({ provisionType: row.provisionType, heading: row.heading, text: row.text })) {
    return `${row.citationLabel} — ${row.text.trim()}`;
  }
  return row.heading ?? row.citationLabel;
}

export async function hydrateProvisions(
  db: PostgresJsDatabase<typeof schema>,
  legalProvisionIds: string[],
): Promise<Map<string, HydratedProvision>> {
  if (legalProvisionIds.length === 0) {
    return new Map();
  }

  const baseRows = await db
    .select({
      legalProvisionId: legalProvisions.id,
      legalActVersionId: legalProvisions.legalActVersionId,
      citationLabel: legalProvisions.citationLabel,
      text: legalProvisions.text,
      legalActId: legalActVersions.legalActId,
      actTitle: legalActs.title,
      versionKind: legalActVersions.versionKind,
      authorityClass: legalActVersions.authorityClass,
      currentnessStatus: legalActVersions.currentnessStatus,
      sourceExpressionId: legalActVersions.sourceExpressionId,
    })
    .from(legalProvisions)
    .innerJoin(legalActVersions, eq(legalActVersions.id, legalProvisions.legalActVersionId))
    .innerJoin(legalActs, eq(legalActs.id, legalActVersions.legalActId))
    .where(inArray(legalProvisions.id, legalProvisionIds));

  const ancestorRows = (await db.execute(sql`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_provision_id, heading, citation_label, text, provision_type, 0 AS depth, id AS leaf_id
      FROM legal_provisions
      WHERE id IN ${legalProvisionIds}
      UNION ALL
      SELECT lp.id, lp.parent_provision_id, lp.heading, lp.citation_label, lp.text, lp.provision_type, a.depth + 1, a.leaf_id
      FROM legal_provisions lp
      INNER JOIN ancestors a ON lp.id = a.parent_provision_id
    )
    SELECT leaf_id AS "leafId", heading, citation_label AS "citationLabel", text, provision_type AS "provisionType", depth
    FROM ancestors
    WHERE depth > 0
    ORDER BY leaf_id, depth DESC
  `)) as unknown as AncestorRow[];

  const hierarchyByLeaf = new Map<string, string[]>();
  for (const row of ancestorRows) {
    const list = hierarchyByLeaf.get(row.leafId) ?? [];
    list.push(formatAncestorContext(row));
    hierarchyByLeaf.set(row.leafId, list);
  }

  const result = new Map<string, HydratedProvision>();
  for (const row of baseRows) {
    result.set(row.legalProvisionId, {
      ...row,
      hierarchy: hierarchyByLeaf.get(row.legalProvisionId) ?? [],
    });
  }

  return result;
}
