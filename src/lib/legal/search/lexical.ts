import { and, desc, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema";
import { legalSearchDocuments } from "../../../db/schema";

const DEFAULT_LIMIT = 30;

export interface LexicalCandidate {
  legalProvisionId: string;
  rank: number;
}

export interface LexicalSearchOptions {
  db: PostgresJsDatabase<typeof schema>;
  legalActVersionIds: string[];
  query: string;
  limit?: number;
}

export async function lexicalSearch(options: LexicalSearchOptions): Promise<LexicalCandidate[]> {
  const { db, legalActVersionIds, query, limit = DEFAULT_LIMIT } = options;
  const trimmedQuery = query.trim();

  if (legalActVersionIds.length === 0 || !trimmedQuery) {
    return [];
  }

  const documentVector = sql`to_tsvector('simple', unaccent(${legalSearchDocuments.content}))`;
  const searchQuery = sql`websearch_to_tsquery('simple', unaccent(${trimmedQuery}))`;

  const rows = await db
    .select({ legalProvisionId: legalSearchDocuments.legalProvisionId })
    .from(legalSearchDocuments)
    .where(
      and(
        inArray(legalSearchDocuments.legalActVersionId, legalActVersionIds),
        sql`${documentVector} @@ ${searchQuery}`,
      ),
    )
    .orderBy(desc(sql`ts_rank_cd(${documentVector}, ${searchQuery})`))
    .limit(limit);

  return rows.map((row, index) => ({ legalProvisionId: row.legalProvisionId, rank: index + 1 }));
}
