import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema";
import type { ParsedLegalCitation } from "./citation";

export interface FindExactCitationMatchesOptions {
  db: PostgresJsDatabase<typeof schema>;
  legalActVersionIds: string[];
  citation: ParsedLegalCitation;
}

interface LeafIdRow {
  id: string;
}

/**
 * The provision tree never denormalizes ancestry onto a row: an `article` row carries
 * `article` but a leaves `paragraph`/`point`/`letter` null, a `clause`/`paragraph`(§) row
 * carries only its own `paragraph`, etc. (see structure.ts's `walkUnit`). A compound citation
 * like "art. 6 ust. 1" therefore names TWO different rows in the tree (the article row AND its
 * clause child) — no single row ever has both `article` and `paragraph` set simultaneously, so
 * treating the parsed citation's fields as a flat AND-predicate against one row (the pre-fix
 * behavior) can never match a compound citation at all.
 *
 * The fix resolves a citation to its DEEPEST named provision (the article/clause/point/letter
 * row implied by the citation's most specific field) and then walks that row's real
 * `parentProvisionId` ancestry (via a recursive CTE, mirroring hydrate.ts's exact pattern) to
 * confirm every SHALLOWER specified field is satisfied by some ancestor — never by flattening
 * into guessed text matching, and never by falling back to a shallower unit when the deepest
 * requested unit doesn't exist (an invalid "art. 6 ust. 99" must return zero matches, not
 * silently resolve to art. 6).
 *
 * A field left null by the parser (e.g. a bare "pkt 3" with no article) is intentionally
 * UNSCOPED at that level — this preserves the pre-existing, documented behavior for citations
 * that don't specify enough context (see citation.ts's own doc comment for "§ N" alone), it is
 * not a new ambiguity introduced here.
 */
export async function findExactCitationMatches(
  options: FindExactCitationMatchesOptions,
): Promise<string[]> {
  const { db, legalActVersionIds, citation } = options;

  if (legalActVersionIds.length === 0) {
    return [];
  }
  const { article, paragraph, point, letter } = citation;
  if (!article && !paragraph && !point && !letter) {
    return [];
  }

  let rows: LeafIdRow[];

  if (letter) {
    // Deepest unit: letter. Ancestors must satisfy point/paragraph/article if specified.
    rows = (await db.execute(sql`
      WITH RECURSIVE ancestry AS (
        SELECT id, parent_provision_id, article, paragraph, point, letter, id AS leaf_id
        FROM legal_provisions
        WHERE legal_act_version_id IN ${legalActVersionIds}
          AND provision_type = 'letter'
          AND letter = ${letter}
        UNION ALL
        SELECT lp.id, lp.parent_provision_id, lp.article, lp.paragraph, lp.point, lp.letter, a.leaf_id
        FROM legal_provisions lp
        INNER JOIN ancestry a ON lp.id = a.parent_provision_id
      )
      SELECT leaf_id AS id
      FROM ancestry
      GROUP BY leaf_id
      HAVING (${point}::text IS NULL OR bool_or(point = ${point}))
        AND (${paragraph}::text IS NULL OR bool_or(paragraph = ${paragraph}))
        AND (${article}::text IS NULL OR bool_or(article = ${article}))
    `)) as unknown as LeafIdRow[];
  } else if (point) {
    // Deepest unit: point. Ancestors must satisfy paragraph/article if specified.
    rows = (await db.execute(sql`
      WITH RECURSIVE ancestry AS (
        SELECT id, parent_provision_id, article, paragraph, point, id AS leaf_id
        FROM legal_provisions
        WHERE legal_act_version_id IN ${legalActVersionIds}
          AND provision_type = 'point'
          AND point = ${point}
        UNION ALL
        SELECT lp.id, lp.parent_provision_id, lp.article, lp.paragraph, lp.point, a.leaf_id
        FROM legal_provisions lp
        INNER JOIN ancestry a ON lp.id = a.parent_provision_id
      )
      SELECT leaf_id AS id
      FROM ancestry
      GROUP BY leaf_id
      HAVING (${paragraph}::text IS NULL OR bool_or(paragraph = ${paragraph}))
        AND (${article}::text IS NULL OR bool_or(article = ${article}))
    `)) as unknown as LeafIdRow[];
  } else if (paragraph) {
    // Deepest unit: paragraph-level (clause "ust." or paragraph "§" — the parser doesn't
    // distinguish the two conventions in this field, so both provision types are eligible;
    // whichever actually exists in a given act's tree is what will match). Ancestor must
    // satisfy article if specified.
    rows = (await db.execute(sql`
      WITH RECURSIVE ancestry AS (
        SELECT id, parent_provision_id, article, paragraph, id AS leaf_id
        FROM legal_provisions
        WHERE legal_act_version_id IN ${legalActVersionIds}
          AND provision_type IN ('clause', 'paragraph')
          AND paragraph = ${paragraph}
        UNION ALL
        SELECT lp.id, lp.parent_provision_id, lp.article, lp.paragraph, a.leaf_id
        FROM legal_provisions lp
        INNER JOIN ancestry a ON lp.id = a.parent_provision_id
      )
      SELECT leaf_id AS id
      FROM ancestry
      GROUP BY leaf_id
      HAVING (${article}::text IS NULL OR bool_or(article = ${article}))
    `)) as unknown as LeafIdRow[];
  } else {
    // Deepest (and only) unit: article. No ancestry needed.
    rows = (await db.execute(sql`
      SELECT id
      FROM legal_provisions
      WHERE legal_act_version_id IN ${legalActVersionIds}
        AND provision_type = 'article'
        AND article = ${article}
    `)) as unknown as LeafIdRow[];
  }

  return rows.map((row) => row.id);
}
