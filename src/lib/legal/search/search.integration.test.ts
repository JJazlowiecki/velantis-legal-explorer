import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { legalActVersions, legalActs, legalProvisions, legalSearchDocuments } from "../../../db/schema";
import { createTestDatabase } from "../../test-support/test-db";
import { findExactCitationMatches } from "./citation-match";
import { parseExactCitation } from "./citation";
import type { EmbedTextsFn } from "./embeddings";
import { indexLegalSearchDocuments } from "./indexing";
import { lexicalSearch } from "./lexical";
import { HybridSearchError, hybridLegalSearch } from "./service";
import { vectorSearch } from "./vector";

const testDatabase = createTestDatabase();
const describeDatabase = testDatabase ? describe : describe.skip;
const client = testDatabase?.client;
const db = testDatabase?.db;

const TEST_SOURCE = "test_search_fixture";
const TEST_SOURCE_ID = "TEST/SEARCH/1";

const DIMENSIONS = 1536;

function basisVector(index: number): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  vector[index] = 1;
  return vector;
}

/** Deterministic fake embedding: buckets text by which marker keyword it contains. */
const fakeEmbed: EmbedTextsFn = async (texts) => {
  return texts.map((text) => {
    if (text.includes("KEYWORD_ALPHA")) return basisVector(0);
    if (text.includes("KEYWORD_BETA")) return basisVector(1);
    if (text.includes("KEYWORD_GAMMA")) return basisVector(2);
    if (text.includes("KEYWORD_DELTA")) return basisVector(3);
    return basisVector(4);
  });
};

afterAll(async () => {
  await client?.end({ timeout: 1 });
});

describeDatabase("legal search infrastructure", () => {
  beforeEach(async () => {
    if (!db) return;
    await db.delete(legalActs).where(and(eq(legalActs.source, TEST_SOURCE), eq(legalActs.sourceId, TEST_SOURCE_ID)));
  });

  async function seedFixture() {
    if (!db) throw new Error("DATABASE_URL is required for integration test");

    const [act] = await db
      .insert(legalActs)
      .values({
        jurisdiction: "PL",
        source: TEST_SOURCE,
        sourceId: TEST_SOURCE_ID,
        title: "Ustawa testowa",
        actType: "ustawa",
      })
      .returning({ id: legalActs.id });

    const [currentVersion] = await db
      .insert(legalActVersions)
      .values({
        legalActId: act.id,
        versionKind: "promulgated",
        sourceExpressionId: "ogl",
        sourceDocumentKey: "test_search_current",
        authorityClass: "authoritative",
        nonAuthoritative: false,
        currentnessStatus: "unproven",
      })
      .returning({ id: legalActVersions.id });

    const [historicalVersion] = await db
      .insert(legalActVersions)
      .values({
        legalActId: act.id,
        versionKind: "promulgated",
        sourceExpressionId: "historical_test",
        sourceDocumentKey: "test_search_historical",
        authorityClass: "authoritative",
        nonAuthoritative: false,
        currentnessStatus: "unproven",
      })
      .returning({ id: legalActVersions.id });

    const [nonAuthoritativeVersion] = await db
      .insert(legalActVersions)
      .values({
        legalActId: act.id,
        versionKind: "unified",
        sourceExpressionId: "uj",
        sourceDocumentKey: "test_search_uj",
        authorityClass: "non_authoritative",
        nonAuthoritative: true,
        currentnessStatus: "unproven",
      })
      .returning({ id: legalActVersions.id });

    const [division] = await db
      .insert(legalProvisions)
      .values({
        legalActVersionId: currentVersion.id,
        provisionType: "division",
        citationLabel: "Dział II - Skutki niewykonania",
        heading: "Dział II - Skutki niewykonania",
        text: "Dział II Skutki niewykonania",
        structuralPath: "div_2",
        ordinal: 1,
      })
      .returning({ id: legalProvisions.id });

    const [art471] = await db
      .insert(legalProvisions)
      .values({
        legalActVersionId: currentVersion.id,
        parentProvisionId: division.id,
        provisionType: "article",
        article: "471",
        citationLabel: "art. 471",
        heading: "Art. 471.",
        text: "Art. 471. KEYWORD_ALPHA Dłużnik obowiązany jest do naprawienia szkody wynikłej z niewykonania zobowiązania.",
        structuralPath: "div_2/art_471",
        ordinal: 2,
      })
      .returning({ id: legalProvisions.id });

    await db.insert(legalProvisions).values({
      legalActVersionId: currentVersion.id,
      parentProvisionId: division.id,
      provisionType: "article",
      article: "472",
      citationLabel: "art. 472",
      heading: "Art. 472.",
      text: "Art. 472. KEYWORD_BETA odpowiedzialność dłużnika za niedbalstwo przy wykonaniu zobowiązania.",
      structuralPath: "div_2/art_472",
      ordinal: 3,
    });

    const [art5container] = await db
      .insert(legalProvisions)
      .values({
        legalActVersionId: currentVersion.id,
        provisionType: "article",
        article: "5",
        citationLabel: "art. 5",
        heading: "Art. 5.",
        text: "Art. 5.",
        structuralPath: "art_5",
        ordinal: 4,
      })
      .returning({ id: legalProvisions.id });

    await db.insert(legalProvisions).values({
      legalActVersionId: currentVersion.id,
      parentProvisionId: art5container.id,
      provisionType: "paragraph",
      article: "5",
      paragraph: "1",
      citationLabel: "art. 5 § 1",
      heading: "§ 1.",
      text: "§ 1. KEYWORD_GAMMA Nie można czynić ze swego prawa użytku sprzecznego ze społeczno-gospodarczym przeznaczeniem — jest to nadużycie prawa.",
      structuralPath: "art_5/para_1",
      ordinal: 5,
    });

    // Same content in a historical version: must never leak into a search scoped to currentVersion only.
    await db.insert(legalProvisions).values({
      legalActVersionId: historicalVersion.id,
      provisionType: "article",
      article: "471",
      citationLabel: "art. 471",
      heading: "Art. 471.",
      text: "Art. 471. KEYWORD_ALPHA historyczne brzmienie przepisu o naprawieniu szkody.",
      structuralPath: "art_471",
      ordinal: 1,
    });

    await db.insert(legalProvisions).values({
      legalActVersionId: nonAuthoritativeVersion.id,
      provisionType: "article",
      article: "471",
      citationLabel: "art. 471",
      heading: "Art. 471.",
      text: "Art. 471. KEYWORD_DELTA tekst ujednolicony bez mocy prawnej.",
      structuralPath: "art_471",
      ordinal: 1,
    });

    return {
      act,
      currentVersion,
      historicalVersion,
      nonAuthoritativeVersion,
      art471,
      art5container,
    };
  }

  it("builds the search index, skips unchanged content, and removes stale documents on re-run", async () => {
    const { currentVersion } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const first = await indexLegalSearchDocuments(currentVersion.id, { db, embedTexts: fakeEmbed });

    // 5 provisions inserted for currentVersion, but "division" (systematic container) and
    // the "art. 5" container article (its paragraph carries the operative content) are
    // excluded, so 3 are searchable: art. 471, art. 472, art. 5 § 1.
    expect(first.provisionsConsidered).toBe(5);
    expect(first.searchDocuments).toBe(3);
    expect(first.embedded).toBe(3);
    expect(first.unchanged).toBe(0);
    expect(first.removed).toBe(0);

    const second = await indexLegalSearchDocuments(currentVersion.id, { db, embedTexts: fakeEmbed });
    expect(second.embedded).toBe(0);
    expect(second.unchanged).toBe(3);
    expect(second.removed).toBe(0);

    const docsAfterSecondRun = await db
      .select()
      .from(legalSearchDocuments)
      .where(eq(legalSearchDocuments.legalActVersionId, currentVersion.id));
    expect(docsAfterSecondRun).toHaveLength(3);

    // Changing a provision's text must change its content hash and trigger re-embedding.
    await db
      .update(legalProvisions)
      .set({ text: "Art. 471. KEYWORD_ALPHA zmieniony tekst przepisu." })
      .where(and(eq(legalProvisions.legalActVersionId, currentVersion.id), eq(legalProvisions.article, "471")));

    const third = await indexLegalSearchDocuments(currentVersion.id, { db, embedTexts: fakeEmbed });
    expect(third.embedded).toBe(1);
    expect(third.unchanged).toBe(2);
    expect(third.removed).toBe(0);

    // A provision that becomes non-searchable (text collapses to just its heading, e.g.
    // its own content moved to a new child) must have its stale derived search document removed
    // even though the source provision row itself still exists.
    await db
      .update(legalProvisions)
      .set({ text: "Art. 472." })
      .where(and(eq(legalProvisions.legalActVersionId, currentVersion.id), eq(legalProvisions.article, "472")));

    const fourth = await indexLegalSearchDocuments(currentVersion.id, { db, embedTexts: fakeEmbed });
    expect(fourth.searchDocuments).toBe(2);
    expect(fourth.removed).toBe(1);

    const docsAfterDelete = await db
      .select()
      .from(legalSearchDocuments)
      .where(eq(legalSearchDocuments.legalActVersionId, currentVersion.id));
    expect(docsAfterDelete).toHaveLength(2);
  });

  it("exact citation lookup finds the provision within the explicit corpus only", async () => {
    const { currentVersion, historicalVersion, art471 } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const citation = parseExactCitation("art. 471");
    expect(citation).not.toBeNull();

    const matches = await findExactCitationMatches({
      db,
      legalActVersionIds: [currentVersion.id],
      citation: citation!,
    });

    expect(matches).toEqual([art471.id]);

    const matchesAcrossBoth = await findExactCitationMatches({
      db,
      legalActVersionIds: [currentVersion.id, historicalVersion.id],
      citation: citation!,
    });
    expect(matchesAcrossBoth).toHaveLength(2);
  });

  it("exact citation lookup finds a container article even though it was never embedded", async () => {
    // "art. 5" is a container: isSearchableProvision() intentionally excludes it
    // from legal_search_documents because its operative text lives entirely in its
    // child paragraph ("art. 5 § 1"). Exact citation lookup must still find it,
    // because it reads legal_provisions directly and never joins/depends on
    // legal_search_documents.
    const { currentVersion, art5container } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const indexed = await indexLegalSearchDocuments(currentVersion.id, { db, embedTexts: fakeEmbed });
    const indexedProvisionIds = (
      await db
        .select({ legalProvisionId: legalSearchDocuments.legalProvisionId })
        .from(legalSearchDocuments)
        .where(eq(legalSearchDocuments.legalActVersionId, currentVersion.id))
    ).map((row) => row.legalProvisionId);
    expect(indexedProvisionIds).not.toContain(art5container.id);
    expect(indexed.searchDocuments).toBeGreaterThan(0);

    const citation = parseExactCitation("art. 5");
    const matches = await findExactCitationMatches({
      db,
      legalActVersionIds: [currentVersion.id],
      citation: citation!,
    });
    expect(matches).toContain(art5container.id);

    const result = await hybridLegalSearch({
      query: "art. 5",
      legalActVersionIds: [currentVersion.id],
      db,
      embedTexts: fakeEmbed,
    });

    const containerResult = result.results.find((item) => item.legalProvisionId === art5container.id);
    expect(containerResult).toBeDefined();
    expect(containerResult?.isExactCitationMatch).toBe(true);
    expect(containerResult?.citationLabel).toBe("art. 5");
  });

  it("lexical search matches on unaccented Polish text and respects the explicit corpus", async () => {
    const { currentVersion, historicalVersion } = await seedFixture();
    if (!db) throw new Error("unreachable");

    await indexLegalSearchDocuments(currentVersion.id, { db, embedTexts: fakeEmbed });
    await indexLegalSearchDocuments(historicalVersion.id, { db, embedTexts: fakeEmbed });

    const withDiacritics = await lexicalSearch({
      db,
      legalActVersionIds: [currentVersion.id],
      query: "nadużycie prawa",
    });
    expect(withDiacritics.length).toBeGreaterThan(0);

    const withoutDiacritics = await lexicalSearch({
      db,
      legalActVersionIds: [currentVersion.id],
      query: "naduzycie prawa",
    });
    expect(withoutDiacritics.length).toBeGreaterThan(0);
    expect(withoutDiacritics[0].legalProvisionId).toBe(withDiacritics[0].legalProvisionId);

    const scopedToHistorical = await lexicalSearch({
      db,
      legalActVersionIds: [historicalVersion.id],
      query: "nadużycie prawa",
    });
    expect(scopedToHistorical).toEqual([]);
  });

  it("vector search returns nearest neighbors scoped to the explicit corpus", async () => {
    const { currentVersion, art471 } = await seedFixture();
    if (!db) throw new Error("unreachable");

    await indexLegalSearchDocuments(currentVersion.id, { db, embedTexts: fakeEmbed });

    const [queryEmbedding] = await fakeEmbed(["KEYWORD_ALPHA"]);
    const results = await vectorSearch({
      db,
      legalActVersionIds: [currentVersion.id],
      queryEmbedding,
    });

    expect(results[0].legalProvisionId).toBe(art471.id);
  });

  it("rejects an empty legalActVersionIds array as a hard safety boundary", async () => {
    if (!db) throw new Error("unreachable");

    await expect(
      hybridLegalSearch({ query: "art. 471", legalActVersionIds: [], db, embedTexts: fakeEmbed }),
    ).rejects.toThrow(HybridSearchError);
  });

  it("never searches a historical version unless it is explicitly supplied", async () => {
    const { currentVersion, historicalVersion } = await seedFixture();
    if (!db) throw new Error("unreachable");

    await indexLegalSearchDocuments(currentVersion.id, { db, embedTexts: fakeEmbed });
    await indexLegalSearchDocuments(historicalVersion.id, { db, embedTexts: fakeEmbed });

    const result = await hybridLegalSearch({
      query: "KEYWORD_ALPHA",
      legalActVersionIds: [currentVersion.id],
      db,
      embedTexts: fakeEmbed,
    });

    expect(result.results.every((item) => item.legalActVersionId === currentVersion.id)).toBe(true);
    expect(result.results.some((item) => item.legalActVersionId === historicalVersion.id)).toBe(false);
  });

  it("ranks an exact citation match ahead of fuzzy results and preserves non-authoritative metadata", async () => {
    const { currentVersion, nonAuthoritativeVersion, art471 } = await seedFixture();
    if (!db) throw new Error("unreachable");

    await indexLegalSearchDocuments(currentVersion.id, { db, embedTexts: fakeEmbed });
    await indexLegalSearchDocuments(nonAuthoritativeVersion.id, { db, embedTexts: fakeEmbed });

    const result = await hybridLegalSearch({
      query: "art. 471",
      legalActVersionIds: [currentVersion.id],
      db,
      embedTexts: fakeEmbed,
    });

    expect(result.results[0].legalProvisionId).toBe(art471.id);
    expect(result.results[0].isExactCitationMatch).toBe(true);
    expect(result.results[0].hierarchy).toContain("Dział II - Skutki niewykonania");

    const nonAuthResult = await hybridLegalSearch({
      query: "KEYWORD_DELTA",
      legalActVersionIds: [nonAuthoritativeVersion.id],
      db,
      embedTexts: fakeEmbed,
    });

    expect(nonAuthResult.results[0].authorityClass).toBe("non_authoritative");
    expect(nonAuthResult.results[0].versionKind).toBe("unified");
  });
});
