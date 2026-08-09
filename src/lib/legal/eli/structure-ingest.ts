import { and, eq, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema";
import { legalActVersions, legalActs, legalProvisions } from "../../../db/schema";
import { type ParsedProvision, parseActStructureHtml } from "./structure";

export class StructureIngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StructureIngestError";
  }
}

/**
 * Thrown when a re-ingestion would replace an existing, non-empty provision set with a
 * materially smaller one (see SHRINK_GUARD_MAX_DROP_RATIO). This is deliberately a distinct,
 * narrowly-typed error so callers (and tests) can tell "the source genuinely has fewer
 * provisions now" apart from "the act/version doesn't exist" or "the HTML didn't parse at
 * all" — the caller decides whether to investigate or pass allowDestructiveShrink.
 */
export class DestructiveShrinkError extends StructureIngestError {
  constructor(
    message: string,
    public readonly existingCount: number,
    public readonly parsedCount: number,
    public readonly maxDropRatio: number,
  ) {
    super(message);
    this.name = "DestructiveShrinkError";
  }
}

type Db = PostgresJsDatabase<typeof schema>;

export interface IngestActStructureInput {
  db: Db;
  /** e.g. "sejm_eli" — matches legal_acts.source. */
  source: string;
  /** e.g. "DU/1964/93" — matches legal_acts.source_id. */
  sourceId: string;
  /** e.g. "ogl" — must match an EXISTING legal_act_versions.source_expression_id row. Never creates a new version. */
  sourceExpressionId: string;
  html: string;
  /**
   * Explicit escape hatch for the destructive-shrink guard (see SHRINK_GUARD_MAX_DROP_RATIO).
   * Defaults to false/unset — the safe default is to REFUSE a materially smaller replacement,
   * not to silently allow it. Only pass true when a smaller parse is genuinely expected (e.g.
   * a real legislative repeal of a large chunk of the act), never as a routine flag.
   */
  allowDestructiveShrink?: boolean;
}

export interface IngestActStructureResult {
  legalActId: string;
  legalActVersionId: string;
  deletedCount: number;
  insertedCount: number;
}

const INSERT_CHUNK_SIZE = 200;

/**
 * Conservative destructive-shrink threshold: if a version already has N > 0 stored provisions
 * and a fresh parse yields fewer than N * (1 - SHRINK_GUARD_MAX_DROP_RATIO), the replacement
 * is refused by default. This is a generic safety margin (not tuned to any specific act's
 * known provision count) meant to catch a parser regression or an upstream HTML change
 * producing a materially incomplete document — not to catch every possible legitimate
 * shrink, which is exactly why an explicit override exists.
 */
export const SHRINK_GUARD_MAX_DROP_RATIO = 0.2;

export interface ReplaceProvisionsForVersionInput {
  db: Db;
  legalActVersionId: string;
  parsed: ParsedProvision[];
  allowDestructiveShrink?: boolean;
}

export interface ReplaceProvisionsForVersionResult {
  deletedCount: number;
  insertedCount: number;
}

/**
 * The shared full-replace-inside-a-transaction core used by both `ingestActStructure` (direct
 * base-act HTML) and the consolidated-TJ pipeline (announcement annex HTML): delete this ONE
 * version's existing provisions, then insert the freshly parsed set — guarded by the same
 * destructive-shrink check either way. Never touches any other version's rows; `legal_search_
 * documents` for the deleted provisions are cleaned up automatically via ON DELETE CASCADE.
 */
export async function replaceProvisionsForVersion(
  input: ReplaceProvisionsForVersionInput,
): Promise<ReplaceProvisionsForVersionResult> {
  if (input.parsed.length === 0) {
    throw new StructureIngestError(
      "Parsed zero provisions from the supplied HTML — refusing to wipe existing structure with an empty result",
    );
  }

  return input.db.transaction(async (tx) => {
    const [{ count: existingCount }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(legalProvisions)
      .where(eq(legalProvisions.legalActVersionId, input.legalActVersionId));

    if (existingCount > 0 && !input.allowDestructiveShrink) {
      const minAllowed = Math.ceil(existingCount * (1 - SHRINK_GUARD_MAX_DROP_RATIO));
      if (input.parsed.length < minAllowed) {
        // Thrown before any DELETE — Drizzle rolls the transaction back, so this is a pure
        // no-op against the database (no DELETE, no partial mutation).
        throw new DestructiveShrinkError(
          `Refusing destructive shrink for legalActVersionId=${input.legalActVersionId}: existing=${existingCount} provisions, new parse=${input.parsed.length} ` +
            `(more than ${Math.round(SHRINK_GUARD_MAX_DROP_RATIO * 100)}% smaller, minimum allowed=${minAllowed}). ` +
            "Pass allowDestructiveShrink if this shrink is genuinely expected.",
          existingCount,
          input.parsed.length,
          SHRINK_GUARD_MAX_DROP_RATIO,
        );
      }
    }

    const deleted = await tx
      .delete(legalProvisions)
      .where(eq(legalProvisions.legalActVersionId, input.legalActVersionId))
      .returning({ id: legalProvisions.id });

    for (let i = 0; i < input.parsed.length; i += INSERT_CHUNK_SIZE) {
      const chunk = input.parsed.slice(i, i + INSERT_CHUNK_SIZE);
      await tx.insert(legalProvisions).values(
        chunk.map((node) => ({
          id: node.id,
          legalActVersionId: input.legalActVersionId,
          parentProvisionId: node.parentId,
          provisionType: node.provisionType,
          article: node.article,
          paragraph: node.paragraph,
          point: node.point,
          letter: node.letter,
          citationLabel: node.citationLabel,
          heading: node.heading,
          text: node.text,
          structuralPath: node.structuralPath,
          ordinal: node.ordinal,
        })),
      );
    }

    return {
      deletedCount: deleted.length,
      insertedCount: input.parsed.length,
    };
  });
}

/**
 * Re-ingests structured provisions for ONE EXISTING legal_act_versions row (looked up by
 * source expression id — never created, never a duplicate). Full-replace semantics inside a
 * single transaction (delete this version's existing provisions, then insert the freshly
 * parsed set) make this idempotent: re-running with the same HTML always converges on the
 * same content, and legal_search_documents rows for the old provisions are cleaned up
 * automatically via their ON DELETE CASCADE FK — never touches any other act/version.
 */
export async function ingestActStructure(input: IngestActStructureInput): Promise<IngestActStructureResult> {
  const [act] = await input.db
    .select({ id: legalActs.id })
    .from(legalActs)
    .where(and(eq(legalActs.source, input.source), eq(legalActs.sourceId, input.sourceId)))
    .limit(1);
  if (!act) {
    throw new StructureIngestError(`No legal_acts row found for source=${input.source} sourceId=${input.sourceId}`);
  }

  // Scoped to the LEGACY (non-announcement-backed) alias only — this function is the direct
  // base-act-HTML pathway (e.g. ogl, or a pre-announcement-model bare tj/uj reachability row).
  // Multiple immutable, announcement-backed "tj" versions may now coexist for one act (see
  // ingestOfficialConsolidatedStructure / consolidated-ingest.ts); without this filter, a lookup
  // by (legalActId, sourceExpressionId) alone would be ambiguous and could silently match/
  // mutate the wrong, immutable version.
  const [version] = await input.db
    .select({ id: legalActVersions.id })
    .from(legalActVersions)
    .where(
      and(
        eq(legalActVersions.legalActId, act.id),
        eq(legalActVersions.sourceExpressionId, input.sourceExpressionId),
        isNull(legalActVersions.sourceAnnouncementLegalActId),
      ),
    )
    .limit(1);
  if (!version) {
    throw new StructureIngestError(
      `No legacy (non-announcement-backed) legal_act_versions row found for act ${input.sourceId} with sourceExpressionId=${input.sourceExpressionId} — refusing to create a new version`,
    );
  }

  // Parse BEFORE any DB mutation — the shrink guard needs the full parsed count to compare
  // against, and nothing must be deleted if the replacement is about to be refused.
  const parsed = parseActStructureHtml(input.html);

  const { deletedCount, insertedCount } = await replaceProvisionsForVersion({
    db: input.db,
    legalActVersionId: version.id,
    parsed,
    allowDestructiveShrink: input.allowDestructiveShrink,
  });

  return {
    legalActId: act.id,
    legalActVersionId: version.id,
    deletedCount,
    insertedCount,
  };
}
