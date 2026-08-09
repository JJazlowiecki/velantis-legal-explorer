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

interface LexemeRow {
  lexemes: string[];
}

/** Escapes a lexeme for use as a quoted tsquery literal: `'foo'` (doubling any embedded quote, per tsquery literal syntax). Lexemes come from `tsvector_to_array`, so in practice they never contain tsquery operator characters — this is defense in depth, not a workaround for an observed case. */
function quoteLexeme(lexeme: string): string {
  return `'${lexeme.replace(/'/g, "''")}'`;
}

/**
 * Builds a tsquery expression requiring at least TWO of the query's distinct lexemes to
 * co-occur in a document (all `C(n,2)` pairs, ORed together) — never just any single shared
 * word. See fuseSearchCandidates (rank.ts): a lexical match is trusted to survive the minimum
 * vector-similarity quality guard unconditionally, so lexical search must not degrade into
 * "any one incidental shared word counts as a match," which would let a single common term
 * (e.g. a generic legal word) unconditionally pad results regardless of actual relevance.
 *
 * With exactly one lexeme, there is no pair to require — that single term is used directly,
 * matching prior single-word-query behavior exactly.
 */
function buildTsQueryExpression(lexemes: string[]): string | null {
  if (lexemes.length === 0) {
    return null;
  }
  if (lexemes.length === 1) {
    return quoteLexeme(lexemes[0]);
  }

  const pairs: string[] = [];
  for (let i = 0; i < lexemes.length; i += 1) {
    for (let j = i + 1; j < lexemes.length; j += 1) {
      pairs.push(`(${quoteLexeme(lexemes[i])} & ${quoteLexeme(lexemes[j])})`);
    }
  }
  return pairs.join(" | ");
}

/**
 * Full-text lexical search. Historically used `websearch_to_tsquery`, which implicitly ANDs
 * every bare word — appropriate for a short literal phrase, but a full natural-language
 * question (e.g. an LLM-generated retrieval query like "kto może oddać krew w Polsce i jakie
 * warunki musi spełnić dawca") almost never has a document containing literally every one of
 * its words, so lexical search contributed ZERO candidates for most ordinary questions
 * (confirmed empirically during a live retrieval-quality investigation). Requiring at least
 * two of the query's own normalized lexemes (same `to_tsvector('simple', unaccent(...))`
 * pipeline used to index documents) to co-occur restores real partial-overlap recall for
 * natural-language queries while still requiring genuine multi-term relevance, not just one
 * coincidentally shared word — see buildTsQueryExpression above.
 */
export async function lexicalSearch(options: LexicalSearchOptions): Promise<LexicalCandidate[]> {
  const { db, legalActVersionIds, query, limit = DEFAULT_LIMIT } = options;
  const trimmedQuery = query.trim();

  if (legalActVersionIds.length === 0 || !trimmedQuery) {
    return [];
  }

  const [lexemeRow] = (await db.execute(
    sql`select tsvector_to_array(to_tsvector('simple', unaccent(${trimmedQuery}))) as lexemes`,
  )) as unknown as LexemeRow[];
  const lexemes = lexemeRow?.lexemes ?? [];

  const queryExpression = buildTsQueryExpression(lexemes);
  if (!queryExpression) {
    return [];
  }

  const documentVector = sql`to_tsvector('simple', unaccent(${legalSearchDocuments.content}))`;
  const searchQuery = sql`to_tsquery('simple', ${queryExpression})`;

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
