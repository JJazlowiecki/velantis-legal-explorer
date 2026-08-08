import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema";
import { legalProvisions } from "../../../db/schema";
import type { ParsedLegalCitation } from "./citation";

export interface FindExactCitationMatchesOptions {
  db: PostgresJsDatabase<typeof schema>;
  legalActVersionIds: string[];
  citation: ParsedLegalCitation;
}

export async function findExactCitationMatches(
  options: FindExactCitationMatchesOptions,
): Promise<string[]> {
  const { db, legalActVersionIds, citation } = options;

  if (legalActVersionIds.length === 0) {
    return [];
  }

  const conditions = [inArray(legalProvisions.legalActVersionId, legalActVersionIds)];

  if (citation.article !== null) {
    conditions.push(eq(legalProvisions.article, citation.article));
  }
  if (citation.paragraph !== null) {
    conditions.push(eq(legalProvisions.paragraph, citation.paragraph));
  }
  if (citation.point !== null) {
    conditions.push(eq(legalProvisions.point, citation.point));
  }
  if (citation.letter !== null) {
    conditions.push(eq(legalProvisions.letter, citation.letter));
  }

  const rows = await db
    .select({ id: legalProvisions.id })
    .from(legalProvisions)
    .where(and(...conditions));

  return rows.map((row) => row.id);
}
