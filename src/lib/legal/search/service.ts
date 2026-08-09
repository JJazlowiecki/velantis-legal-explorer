import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema";
import { findExactCitationMatches } from "./citation-match";
import { parseExactCitation } from "./citation";
import { EmbeddingError, embedTexts, type EmbedTextsFn } from "./embeddings";
import { hydrateProvisions } from "./hydrate";
import { lexicalSearch } from "./lexical";
import { fuseSearchCandidates } from "./rank";
import type { HybridSearchResult } from "./types";
import { vectorSearch } from "./vector";

export class HybridSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HybridSearchError";
  }
}

export interface HybridLegalSearchOptions {
  query: string;
  legalActVersionIds: string[];
  limit?: number;
  candidateLimit?: number;
  db?: PostgresJsDatabase<typeof schema>;
  embedTexts?: EmbedTextsFn;
  /**
   * Minimum cosine similarity required for a vector-only candidate (found by no
   * other signal) to be kept — see rank.ts. Defaults to
   * LEGAL_SEARCH_MIN_VECTOR_SIMILARITY, or 0.15 if unset/invalid.
   */
  minVectorSimilarity?: number;
}

export interface HybridLegalSearchResult {
  query: string;
  legalActVersionIds: string[];
  vectorSearchSkippedReason: string | null;
  results: HybridSearchResult[];
  timingsMs: {
    lexical: number;
    vector: number;
    total: number;
  };
}

const DEFAULT_LIMIT = 10;
const DEFAULT_CANDIDATE_LIMIT = 30;
// Keep in sync with src/lib/env/schema.ts LEGAL_SEARCH_MIN_VECTOR_SIMILARITY default;
// see that file for the calibration rationale.
const DEFAULT_MIN_VECTOR_SIMILARITY = 0.35;

function resolveMinVectorSimilarity(): number {
  const raw = process.env.LEGAL_SEARCH_MIN_VECTOR_SIMILARITY;
  if (raw === undefined || raw === "") {
    return DEFAULT_MIN_VECTOR_SIMILARITY;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_MIN_VECTOR_SIMILARITY;
}

export async function hybridLegalSearch(
  options: HybridLegalSearchOptions,
): Promise<HybridLegalSearchResult> {
  const startedAt = Date.now();

  if (!options.legalActVersionIds || options.legalActVersionIds.length === 0) {
    throw new HybridSearchError(
      "legalActVersionIds is required and must be non-empty: search never runs against a global default corpus",
    );
  }

  const query = options.query.trim();
  if (!query) {
    throw new HybridSearchError("query must not be empty");
  }

  const legalActVersionIds = [...new Set(options.legalActVersionIds)];
  const limit = options.limit ?? DEFAULT_LIMIT;
  const candidateLimit = options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;
  const minVectorSimilarity = options.minVectorSimilarity ?? resolveMinVectorSimilarity();
  const embed = options.embedTexts ?? embedTexts;

  const db = options.db ?? (await import("../../../db/script-db")).getScriptDb();

  const parsedCitation = parseExactCitation(query);
  const exactCitationMatchesPromise = parsedCitation
    ? findExactCitationMatches({ db, legalActVersionIds, citation: parsedCitation })
    : Promise.resolve<string[]>([]);

  const lexicalStartedAt = Date.now();
  const lexicalPromise = lexicalSearch({ db, legalActVersionIds, query, limit: candidateLimit });

  let vectorSearchSkippedReason: string | null = null;
  let queryEmbedding: number[] | null = null;

  try {
    const [embedding] = await embed([query]);
    queryEmbedding = embedding ?? null;
  } catch (error) {
    if (error instanceof EmbeddingError) {
      vectorSearchSkippedReason = `Embedding unavailable: ${error.message}`;
    } else {
      throw error;
    }
  }

  const [lexicalCandidates, exactCitationMatches] = await Promise.all([
    lexicalPromise,
    exactCitationMatchesPromise,
  ]);
  const lexicalMs = Date.now() - lexicalStartedAt;

  const vectorStartedAt = Date.now();
  const vectorCandidates = queryEmbedding
    ? await vectorSearch({ db, legalActVersionIds, queryEmbedding, limit: candidateLimit })
    : [];
  const vectorMs = Date.now() - vectorStartedAt;

  const fused = fuseSearchCandidates(lexicalCandidates, vectorCandidates, new Set(exactCitationMatches), {
    minVectorSimilarity,
  }).slice(0, limit);

  const hydrated = await hydrateProvisions(
    db,
    fused.map((item) => item.legalProvisionId),
  );

  const results: HybridSearchResult[] = fused
    .map((item) => {
      const provision = hydrated.get(item.legalProvisionId);
      if (!provision) {
        return null;
      }

      return {
        legalProvisionId: provision.legalProvisionId,
        legalActVersionId: provision.legalActVersionId,
        legalActId: provision.legalActId,
        actTitle: provision.actTitle,
        citationLabel: provision.citationLabel,
        text: provision.text,
        hierarchy: provision.hierarchy,
        lexicalRank: item.lexicalRank,
        vectorRank: item.vectorRank,
        vectorSimilarity: item.vectorSimilarity,
        isExactCitationMatch: item.isExactCitationMatch,
        finalScore: item.score,
        versionKind: provision.versionKind,
        authorityClass: provision.authorityClass,
        currentnessStatus: provision.currentnessStatus,
        sourceExpressionId: provision.sourceExpressionId,
      } satisfies HybridSearchResult;
    })
    .filter((result): result is HybridSearchResult => result !== null);

  return {
    query,
    legalActVersionIds,
    vectorSearchSkippedReason,
    results,
    timingsMs: {
      lexical: lexicalMs,
      vector: vectorMs,
      total: Date.now() - startedAt,
    },
  };
}
