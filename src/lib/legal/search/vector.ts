import { and, asc, cosineDistance, inArray, isNotNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema";
import { legalSearchDocuments } from "../../../db/schema";

const DEFAULT_LIMIT = 30;

export interface VectorCandidate {
  legalProvisionId: string;
  rank: number;
  /** Cosine similarity in [-1, 1], i.e. `1 - cosineDistance`. Higher is more similar. */
  similarity: number;
}

export interface VectorSearchOptions {
  db: PostgresJsDatabase<typeof schema>;
  legalActVersionIds: string[];
  queryEmbedding: number[];
  limit?: number;
}

export async function vectorSearch(options: VectorSearchOptions): Promise<VectorCandidate[]> {
  const { db, legalActVersionIds, queryEmbedding, limit = DEFAULT_LIMIT } = options;

  if (legalActVersionIds.length === 0 || queryEmbedding.length === 0) {
    return [];
  }

  const cosineDistanceExpr = cosineDistance(legalSearchDocuments.embedding, queryEmbedding);

  const rows = await db
    .select({ legalProvisionId: legalSearchDocuments.legalProvisionId, cosineDistance: cosineDistanceExpr })
    .from(legalSearchDocuments)
    .where(
      and(
        inArray(legalSearchDocuments.legalActVersionId, legalActVersionIds),
        isNotNull(legalSearchDocuments.embedding),
      ),
    )
    .orderBy(asc(cosineDistanceExpr))
    .limit(limit);

  return rows.map((row, index) => ({
    legalProvisionId: row.legalProvisionId,
    rank: index + 1,
    similarity: 1 - Number(row.cosineDistance),
  }));
}
