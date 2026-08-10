import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { legalActVersions, legalActs, legalProvisions } from "../../../db/schema";
import { createTestDatabase } from "../../test-support/test-db";
import { parseExactCitation } from "./citation";
import { findExactCitationMatches } from "./citation-match";

const testDatabase = createTestDatabase();
const describeDatabase = testDatabase ? describe : describe.skip;
const client = testDatabase?.client;
const db = testDatabase?.db;

const TEST_SOURCE = "test_citation_match_fixture";
const TEST_SOURCE_ID_A = "TEST/CITATION-MATCH/A";
const TEST_SOURCE_ID_B = "TEST/CITATION-MATCH/B";

afterAll(async () => {
  await client?.end({ timeout: 1 });
});

describeDatabase("findExactCitationMatches — hierarchical resolution", () => {
  beforeEach(async () => {
    if (!db) return;
    await db
      .delete(legalActs)
      .where(and(eq(legalActs.source, TEST_SOURCE), eq(legalActs.sourceId, TEST_SOURCE_ID_A)));
    await db
      .delete(legalActs)
      .where(and(eq(legalActs.source, TEST_SOURCE), eq(legalActs.sourceId, TEST_SOURCE_ID_B)));
  });

  /**
   * One version ("A") with two sibling articles (art. 6 and art. 11), where art. 11's own
   * ust./pkt/lit children are DELIBERATELY numbered identically to art. 6's ("ust. 1",
   * "pkt 2", "lit. a") — this is what proves the matcher resolves via real ancestry, not by
   * flattening/guessing from the leaf numbering alone (test 9). A second version ("B") of a
   * different act repeats art. 6's exact numbering again, to prove legalActVersionId scoping
   * (tests 10-11).
   */
  async function seedFixture() {
    if (!db) throw new Error("TEST_DATABASE_URL is required for integration test");

    async function seedVersion(sourceId: string) {
      if (!db) throw new Error("unreachable");
      const [act] = await db
        .insert(legalActs)
        .values({ jurisdiction: "PL", source: TEST_SOURCE, sourceId, title: "Ustawa testowa", actType: "ustawa" })
        .returning({ id: legalActs.id });

      const [version] = await db
        .insert(legalActVersions)
        .values({
          legalActId: act.id,
          versionKind: "promulgated",
          sourceExpressionId: "ogl",
          sourceDocumentKey: `test_citation_match_${sourceId}`,
          authorityClass: "authoritative",
          nonAuthoritative: false,
          currentnessStatus: "unproven",
        })
        .returning({ id: legalActVersions.id });

      const [art6] = await db
        .insert(legalProvisions)
        .values({
          legalActVersionId: version.id,
          provisionType: "article",
          article: "6",
          citationLabel: "art. 6",
          heading: "Art. 6.",
          text: "Art. 6.",
          structuralPath: "art_6",
          ordinal: 1,
        })
        .returning({ id: legalProvisions.id });

      const [art6ust1] = await db
        .insert(legalProvisions)
        .values({
          legalActVersionId: version.id,
          parentProvisionId: art6.id,
          provisionType: "clause",
          paragraph: "1",
          citationLabel: "art. 6 ust. 1",
          heading: "1.",
          text: "1. Producentowi bazy danych przysługuje wyłączne prawo.",
          structuralPath: "art_6/ust_1",
          ordinal: 2,
        })
        .returning({ id: legalProvisions.id });

      await db.insert(legalProvisions).values({
        legalActVersionId: version.id,
        parentProvisionId: art6.id,
        provisionType: "clause",
        paragraph: "2",
        citationLabel: "art. 6 ust. 2",
        heading: "2.",
        text: "2. Domniemywa się, że producentem jest osoba...",
        structuralPath: "art_6/ust_2",
        ordinal: 3,
      });

      const [art6ust1pkt2] = await db
        .insert(legalProvisions)
        .values({
          legalActVersionId: version.id,
          parentProvisionId: art6ust1.id,
          provisionType: "point",
          point: "2",
          citationLabel: "art. 6 ust. 1 pkt 2",
          heading: null,
          text: "2) wtórnego wykorzystania;",
          structuralPath: "art_6/ust_1/pkt_2",
          ordinal: 4,
        })
        .returning({ id: legalProvisions.id });

      const [art6ust1pkt2litA] = await db
        .insert(legalProvisions)
        .values({
          legalActVersionId: version.id,
          parentProvisionId: art6ust1pkt2.id,
          provisionType: "letter",
          letter: "a",
          citationLabel: "art. 6 ust. 1 pkt 2 lit. a",
          heading: null,
          text: "a) w całości,",
          structuralPath: "art_6/ust_1/pkt_2/lit_a",
          ordinal: 5,
        })
        .returning({ id: legalProvisions.id });

      return { version, art6, art6ust1, art6ust1pkt2, art6ust1pkt2litA };
    }

    const a = await seedVersion(TEST_SOURCE_ID_A);

    // Sibling article 11 under the SAME version, with numbering that collides with art. 6's
    // descendants (ust. 1 / pkt 2 / lit. a) — proves ancestry, not flat number matching.
    if (!db) throw new Error("unreachable");
    const [art11] = await db
      .insert(legalProvisions)
      .values({
        legalActVersionId: a.version.id,
        provisionType: "article",
        article: "11",
        citationLabel: "art. 11",
        heading: "Art. 11.",
        text: "Art. 11.",
        structuralPath: "art_11",
        ordinal: 6,
      })
      .returning({ id: legalProvisions.id });

    const [art11ust1] = await db
      .insert(legalProvisions)
      .values({
        legalActVersionId: a.version.id,
        parentProvisionId: art11.id,
        provisionType: "clause",
        paragraph: "1",
        citationLabel: "art. 11 ust. 1",
        heading: "1.",
        text: "1. Producent, którego prawa zostały naruszone, może żądać:",
        structuralPath: "art_11/ust_1",
        ordinal: 7,
      })
      .returning({ id: legalProvisions.id });

    const [art11ust1pkt2] = await db
      .insert(legalProvisions)
      .values({
        legalActVersionId: a.version.id,
        parentProvisionId: art11ust1.id,
        provisionType: "point",
        point: "2",
        citationLabel: "art. 11 ust. 1 pkt 2",
        heading: null,
        text: "2) usunięcia skutków naruszenia;",
        structuralPath: "art_11/ust_1/pkt_2",
        ordinal: 8,
      })
      .returning({ id: legalProvisions.id });

    await db.insert(legalProvisions).values({
      legalActVersionId: a.version.id,
      parentProvisionId: art11ust1pkt2.id,
      provisionType: "letter",
      letter: "a",
      citationLabel: "art. 11 ust. 1 pkt 2 lit. a",
      heading: null,
      text: "a) na zasadach ogólnych,",
      structuralPath: "art_11/ust_1/pkt_2/lit_a",
      ordinal: 9,
    });

    // A second, independent version of a DIFFERENT act repeating art. 6's exact numbering.
    const b = await seedVersion(TEST_SOURCE_ID_B);

    return { a, b, art11, art11ust1, art11ust1pkt2 };
  }

  it("1: simple article citation resolves", async () => {
    const { a } = await seedFixture();
    if (!db) throw new Error("unreachable");
    const citation = parseExactCitation("art. 6")!;
    const matches = await findExactCitationMatches({ db, legalActVersionIds: [a.version.id], citation });
    expect(matches).toEqual([a.art6.id]);
  });

  it("2: article + ustęp resolves the deepest child (the clause row, not the article row)", async () => {
    const { a } = await seedFixture();
    if (!db) throw new Error("unreachable");
    const citation = parseExactCitation("art. 6 ust. 1")!;
    const matches = await findExactCitationMatches({ db, legalActVersionIds: [a.version.id], citation });
    expect(matches).toEqual([a.art6ust1.id]);
  });

  it("3: article + ustęp + pkt resolves the deepest child (the point row)", async () => {
    const { a } = await seedFixture();
    if (!db) throw new Error("unreachable");
    const citation = parseExactCitation("art. 6 ust. 1 pkt 2")!;
    const matches = await findExactCitationMatches({ db, legalActVersionIds: [a.version.id], citation });
    expect(matches).toEqual([a.art6ust1pkt2.id]);
  });

  it("4: article + ustęp + pkt + lit resolves the deepest child (the letter row)", async () => {
    const { a } = await seedFixture();
    if (!db) throw new Error("unreachable");
    const citation = parseExactCitation("art. 6 ust. 1 pkt 2 lit. a")!;
    const matches = await findExactCitationMatches({ db, legalActVersionIds: [a.version.id], citation });
    expect(matches).toEqual([a.art6ust1pkt2litA.id]);
  });

  it("5: wrong ustęp returns no exact match (does not fall back to the article)", async () => {
    const { a } = await seedFixture();
    if (!db) throw new Error("unreachable");
    const citation = parseExactCitation("art. 6 ust. 99")!;
    const matches = await findExactCitationMatches({ db, legalActVersionIds: [a.version.id], citation });
    expect(matches).toEqual([]);
  });

  it("6: wrong punkt returns no exact match (does not fall back to the ustęp)", async () => {
    const { a } = await seedFixture();
    if (!db) throw new Error("unreachable");
    const citation = parseExactCitation("art. 6 ust. 1 pkt 99")!;
    const matches = await findExactCitationMatches({ db, legalActVersionIds: [a.version.id], citation });
    expect(matches).toEqual([]);
  });

  it("7: wrong letter returns no exact match (does not fall back to the punkt)", async () => {
    const { a } = await seedFixture();
    if (!db) throw new Error("unreachable");
    const citation = parseExactCitation("art. 6 ust. 1 pkt 2 lit. z")!;
    const matches = await findExactCitationMatches({ db, legalActVersionIds: [a.version.id], citation });
    expect(matches).toEqual([]);
  });

  it("8: valid article + invalid child does NOT fall back to the article", async () => {
    const { a } = await seedFixture();
    if (!db) throw new Error("unreachable");
    // art. 6 exists, but art. 6 has no pkt 5 anywhere in its subtree.
    const citation = parseExactCitation("art. 6 pkt 5")!;
    const matches = await findExactCitationMatches({ db, legalActVersionIds: [a.version.id], citation });
    expect(matches).toEqual([]);
  });

  it("9: same numbering (ust. 1 pkt 2 lit. a) under a different article does not cross-match", async () => {
    const { a, art11ust1pkt2 } = await seedFixture();
    if (!db) throw new Error("unreachable");
    const citation = parseExactCitation("art. 11 ust. 1 pkt 2")!;
    const matches = await findExactCitationMatches({ db, legalActVersionIds: [a.version.id], citation });
    expect(matches).toEqual([art11ust1pkt2.id]);
    expect(matches).not.toContain(a.art6ust1pkt2.id);
  });

  it("10: same citation in another legalActVersion is isolated by the version filter", async () => {
    const { a, b } = await seedFixture();
    if (!db) throw new Error("unreachable");
    const citation = parseExactCitation("art. 6 ust. 1")!;

    const matchesA = await findExactCitationMatches({ db, legalActVersionIds: [a.version.id], citation });
    expect(matchesA).toEqual([a.art6ust1.id]);

    const matchesB = await findExactCitationMatches({ db, legalActVersionIds: [b.version.id], citation });
    expect(matchesB).toEqual([b.art6ust1.id]);

    expect(matchesA[0]).not.toBe(matchesB[0]);
  });

  it("11: multiple permitted legalActVersionIds remain correctly scoped (both resolve, no cross-contamination)", async () => {
    const { a, b } = await seedFixture();
    if (!db) throw new Error("unreachable");
    const citation = parseExactCitation("art. 6 ust. 1")!;

    const matches = await findExactCitationMatches({
      db,
      legalActVersionIds: [a.version.id, b.version.id],
      citation,
    });

    expect(new Set(matches)).toEqual(new Set([a.art6ust1.id, b.art6ust1.id]));
  });

  it("12/13: exact match is injected ahead of fused candidates and survives regardless of lexical/vector ranking", async () => {
    // fuseSearchCandidates (rank.ts) always sorts isExactCitationMatch first, unconditionally
    // of score — this is unit-testable purely from the exact-match id set without a live
    // lexical/vector search, and is covered directly by rank.test.ts's existing exact-citation
    // ordering tests. Here we only confirm findExactCitationMatches returns the SAME provision
    // id that a compound citation names, which is the id rank.ts's exactCitationProvisionIds
    // set is built from at the call site (search/service.ts).
    const { a } = await seedFixture();
    if (!db) throw new Error("unreachable");
    const citation = parseExactCitation("art. 6 ust. 1 pkt 2 lit. a")!;
    const matches = await findExactCitationMatches({ db, legalActVersionIds: [a.version.id], citation });
    expect(matches).toEqual([a.art6ust1pkt2litA.id]);
  });

  it("14: unscoped bare-field citations (parser produces article=null) match across any article, unchanged from prior documented behavior", async () => {
    const { a, art11ust1pkt2 } = await seedFixture();
    if (!db) throw new Error("unreachable");
    // "pkt 2" alone (no "art."/"ust." prefix) parses to {article:null, paragraph:null, point:"2", letter:null}.
    const citation = parseExactCitation("pkt 2")!;
    expect(citation.article).toBeNull();
    const matches = await findExactCitationMatches({ db, legalActVersionIds: [a.version.id], citation });
    // Unscoped: both art. 6 ust. 1 pkt 2 AND art. 11 ust. 1 pkt 2 match, exactly as a bare
    // paragraph/point search across any article already did before this fix.
    expect(new Set(matches)).toEqual(new Set([a.art6ust1pkt2.id, art11ust1pkt2.id]));
  });
});
