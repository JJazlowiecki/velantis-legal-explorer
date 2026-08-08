import { eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema";
import { legalActVersions, legalActs, legalProvisions } from "../../../db/schema";

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
  depth: number;
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
      SELECT id, parent_provision_id, heading, citation_label, 0 AS depth, id AS leaf_id
      FROM legal_provisions
      WHERE id IN ${legalProvisionIds}
      UNION ALL
      SELECT lp.id, lp.parent_provision_id, lp.heading, lp.citation_label, a.depth + 1, a.leaf_id
      FROM legal_provisions lp
      INNER JOIN ancestors a ON lp.id = a.parent_provision_id
    )
    SELECT leaf_id AS "leafId", heading, citation_label AS "citationLabel", depth
    FROM ancestors
    WHERE depth > 0
    ORDER BY leaf_id, depth DESC
  `)) as unknown as AncestorRow[];

  const hierarchyByLeaf = new Map<string, string[]>();
  for (const row of ancestorRows) {
    const list = hierarchyByLeaf.get(row.leafId) ?? [];
    list.push(row.heading ?? row.citationLabel);
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
