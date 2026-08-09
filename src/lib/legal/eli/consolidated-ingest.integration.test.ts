import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { legalActVersions, legalActs, legalProvisions } from "../../../db/schema";
import { createTestDatabase } from "../../test-support/test-db";
import { ConsolidatedIngestError, ingestOfficialConsolidatedStructure } from "./consolidated-ingest";
import { AnnexSelectionError } from "./structure";
import { DestructiveShrinkError } from "./structure-ingest";
import { ELI_SOURCE } from "./schema";
import type { EliActMetadata, EliActReferences } from "./schema";

const testDatabase = createTestDatabase();
const describeDatabase = testDatabase ? describe : describe.skip;
const client = testDatabase?.client;
const db = testDatabase?.db;

const BASE_SOURCE_ID = "TEST/1964/93";
const ANNOUNCEMENT_A_SOURCE_ID = "TEST/2024/1061";
const ANNOUNCEMENT_B_SOURCE_ID = "TEST/2026/795";

function baseMetadata(): EliActMetadata {
  return {
    publisher: "TEST",
    year: 1964,
    pos: 93,
    title: "Ustawa testowa - Kodeks testowy",
    type: "Ustawa",
    status: "akt posiada tekst jednolity",
    inForce: "IN_FORCE",
  };
}

function announcementMetadata(overrides: Partial<EliActMetadata> & { year: number; pos: number }): EliActMetadata {
  return {
    publisher: "TEST",
    title: `Obwieszczenie w sprawie ogłoszenia jednolitego tekstu ustawy - Kodeks testowy (${overrides.year}/${overrides.pos})`,
    type: "Obwieszczenie",
    status: "obowiązujący",
    inForce: "IN_FORCE",
    legalStatusDate: "2024-06-19",
    ...overrides,
  };
}

function annexHtml(articleText: string): string {
  return `<!DOCTYPE HTML><html><body>
    <div class="parts">
      <section id="part_1">
        <div class="part" id="_001">
          <h2 class="part"><span class=" ">Treść obwieszczenia</span></h2>
          <div class="block">
            <div class="unit unit_arti pro-text false" id="pass_1" data-id="pass_1">
              <h3 CLASS="pro-none"><B CLASS="b">1.</B></h3>
              <div class="unit-inner"><div data-template="xText" CLASS="pro-text">Preamble text — must never become a base-statute provision.</div></div>
            </div>
          </div>
        </div>
      </section>
      <section id="part_2">
        <div class="part" id="_002">
          <h2 class="part"><span class=" ">Załącznik&nbsp;&nbsp;-&nbsp;&nbsp;Tekst jednolity ustawy z dnia 23 kwietnia 1964&nbsp;r. Kodeks testowy</span></h2>
          <div class="block">
            <div class="unit unit_arti pro-text false" id="arti_1" data-id="arti_1">
              <h3 CLASS="pro-none"><B CLASS="b">Art.&nbsp;1.</B></h3>
              <div class="unit-inner"><div data-template="xText" CLASS="pro-text">${articleText}</div></div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </body></html>`;
}

function referencesFor(kind: "base-correct" | "base-wrong" | "empty", announcementSourceId: string): EliActReferences {
  const [publisher, year, pos] = announcementSourceId.split("/");
  if (kind === "base-correct") {
    return {
      "Inf. o tekście jednolitym": [{ act: { publisher, year: Number(year), pos: Number(pos), title: "Announcement" } }],
    };
  }
  if (kind === "base-wrong") {
    return {
      "Inf. o tekście jednolitym": [{ act: { publisher: "TEST", year: 1900, pos: 1, title: "Unrelated announcement" } }],
    };
  }
  return {};
}

function announcementReferencesFor(kind: "correct" | "wrong" | "empty"): EliActReferences {
  if (kind === "correct") {
    return {
      "Tekst jednolity dla aktu": [{ act: { publisher: "TEST", year: 1964, pos: 93, title: "Base act" } }],
    };
  }
  if (kind === "wrong") {
    return {
      "Tekst jednolity dla aktu": [{ act: { publisher: "TEST", year: 1900, pos: 1, title: "Unrelated base act" } }],
    };
  }
  return {};
}

async function insertBaseAct() {
  if (!db) throw new Error("unreachable");
  const [row] = await db
    .insert(legalActs)
    .values({ jurisdiction: "PL", source: ELI_SOURCE, sourceId: BASE_SOURCE_ID, title: "Kodeks testowy", actType: "Ustawa" })
    .returning();
  return row;
}

afterAll(async () => {
  await client?.end({ timeout: 1 });
});

describeDatabase("ingestOfficialConsolidatedStructure", () => {
  beforeEach(async () => {
    if (!db) return;
    await db
      .delete(legalActs)
      .where(
        and(
          eq(legalActs.source, ELI_SOURCE),
          sql`${legalActs.sourceId} IN (${BASE_SOURCE_ID}, ${ANNOUNCEMENT_A_SOURCE_ID}, ${ANNOUNCEMENT_B_SOURCE_ID})`,
        ),
      );
  });

  it("throws and writes nothing when the base act does not list the announcement under 'Inf. o tekście jednolitym'", async () => {
    if (!db) throw new Error("unreachable");
    const base = await insertBaseAct();

    const attempt = ingestOfficialConsolidatedStructure({
      db,
      baseActSourceId: BASE_SOURCE_ID,
      announcementActSourceId: ANNOUNCEMENT_A_SOURCE_ID,
      fetchMetadata: async (coords) =>
        coords.position === 93 ? baseMetadata() : announcementMetadata({ year: 2024, pos: 1061 }),
      fetchReferences: async (coords) =>
        coords.position === 93 ? referencesFor("base-wrong", ANNOUNCEMENT_A_SOURCE_ID) : announcementReferencesFor("correct"),
      fetchHtml: async () => annexHtml("Should never be fetched to this point in a real failure, but harmless if it is."),
    });

    await expect(attempt).rejects.toThrow(ConsolidatedIngestError);

    const announcementRow = await db.select().from(legalActs).where(eq(legalActs.sourceId, ANNOUNCEMENT_A_SOURCE_ID));
    expect(announcementRow).toHaveLength(0);
    // Scoped to THIS test's own base act — the DB-wide table is shared with other test files
    // running concurrently against the same TEST_DATABASE_URL, so an unscoped query here would
    // be vulnerable to unrelated, perfectly valid rows created by unrelated concurrent tests.
    const versions = await db.select().from(legalActVersions).where(eq(legalActVersions.legalActId, base.id));
    expect(versions.filter((v) => v.sourceAnnouncementLegalActId !== null)).toHaveLength(0);
  });

  it("throws and writes nothing when the announcement does not reference the base act back under 'Tekst jednolity dla aktu' (mismatched pair)", async () => {
    if (!db) throw new Error("unreachable");
    const base = await insertBaseAct();

    const attempt = ingestOfficialConsolidatedStructure({
      db,
      baseActSourceId: BASE_SOURCE_ID,
      announcementActSourceId: ANNOUNCEMENT_A_SOURCE_ID,
      fetchMetadata: async (coords) =>
        coords.position === 93 ? baseMetadata() : announcementMetadata({ year: 2024, pos: 1061 }),
      fetchReferences: async (coords) =>
        coords.position === 93 ? referencesFor("base-correct", ANNOUNCEMENT_A_SOURCE_ID) : announcementReferencesFor("wrong"),
      fetchHtml: async () => annexHtml("Consolidated text."),
    });

    await expect(attempt).rejects.toThrow(ConsolidatedIngestError);
    const versions = await db.select().from(legalActVersions).where(eq(legalActVersions.legalActId, base.id));
    expect(versions.filter((v) => v.sourceAnnouncementLegalActId !== null)).toHaveLength(0);
  });

  it("throws when the base act row doesn't exist yet — never creates a base act from a consolidated ingest", async () => {
    if (!db) throw new Error("unreachable");

    const attempt = ingestOfficialConsolidatedStructure({
      db,
      baseActSourceId: BASE_SOURCE_ID,
      announcementActSourceId: ANNOUNCEMENT_A_SOURCE_ID,
      fetchMetadata: async (coords) =>
        coords.position === 93 ? baseMetadata() : announcementMetadata({ year: 2024, pos: 1061 }),
      fetchReferences: async (coords) =>
        coords.position === 93 ? referencesFor("base-correct", ANNOUNCEMENT_A_SOURCE_ID) : announcementReferencesFor("correct"),
      fetchHtml: async () => annexHtml("Consolidated text."),
    });

    await expect(attempt).rejects.toThrow(ConsolidatedIngestError);
  });

  it("creates the announcement as its own legal_acts identity and an immutable, correctly-provenanced TJ version", async () => {
    if (!db) throw new Error("unreachable");
    const base = await insertBaseAct();

    const result = await ingestOfficialConsolidatedStructure({
      db,
      baseActSourceId: BASE_SOURCE_ID,
      announcementActSourceId: ANNOUNCEMENT_A_SOURCE_ID,
      fetchMetadata: async (coords) =>
        coords.position === 93 ? baseMetadata() : announcementMetadata({ year: 2024, pos: 1061, legalStatusDate: "2024-06-19" }),
      fetchReferences: async (coords) =>
        coords.position === 93 ? referencesFor("base-correct", ANNOUNCEMENT_A_SOURCE_ID) : announcementReferencesFor("correct"),
      fetchHtml: async () => annexHtml("Consolidated text v1."),
    });

    expect(result.versionAction).toBe("inserted");
    expect(result.insertedCount).toBe(2); // root "part" + 1 article

    const announcementRow = (
      await db.select().from(legalActs).where(eq(legalActs.sourceId, ANNOUNCEMENT_A_SOURCE_ID))
    )[0];
    expect(announcementRow).toBeDefined();
    expect(announcementRow.id).toBe(result.announcementLegalActId);

    const [version] = await db
      .select()
      .from(legalActVersions)
      .where(eq(legalActVersions.id, result.legalActVersionId));
    expect(version).toMatchObject({
      legalActId: base.id,
      versionKind: "consolidated",
      sourceExpressionId: "tj",
      sourceAnnouncementLegalActId: announcementRow.id,
      authorityClass: "authoritative",
      nonAuthoritative: false,
      currentnessStatus: "unproven",
      legalStateDate: "2024-06-19",
      isCurrent: false,
    });

    const provisions = await db.select().from(legalProvisions).where(eq(legalProvisions.legalActVersionId, version.id));
    const texts = provisions.map((p) => p.text);
    expect(texts.some((t) => t.includes("Preamble text"))).toBe(false);
    expect(texts.some((t) => t.includes("Consolidated text v1"))).toBe(true);
  });

  it("propagates AnnexSelectionError when the announcement HTML has no identifiable annex", async () => {
    if (!db) throw new Error("unreachable");
    await insertBaseAct();

    const attempt = ingestOfficialConsolidatedStructure({
      db,
      baseActSourceId: BASE_SOURCE_ID,
      announcementActSourceId: ANNOUNCEMENT_A_SOURCE_ID,
      fetchMetadata: async (coords) =>
        coords.position === 93 ? baseMetadata() : announcementMetadata({ year: 2024, pos: 1061 }),
      fetchReferences: async (coords) =>
        coords.position === 93 ? referencesFor("base-correct", ANNOUNCEMENT_A_SOURCE_ID) : announcementReferencesFor("correct"),
      fetchHtml: async () => "<html><body><div class=\"parts\"></div></body></html>",
    });

    await expect(attempt).rejects.toThrow(AnnexSelectionError);
  });

  it("is idempotent for the SAME announcement (same version id, shrink-guarded)", async () => {
    if (!db) throw new Error("unreachable");
    await insertBaseAct();

    const fetchMetadata = async (coords: { position: number }) =>
      coords.position === 93 ? baseMetadata() : announcementMetadata({ year: 2024, pos: 1061 });
    const fetchReferences = async (coords: { position: number }) =>
      coords.position === 93 ? referencesFor("base-correct", ANNOUNCEMENT_A_SOURCE_ID) : announcementReferencesFor("correct");

    const first = await ingestOfficialConsolidatedStructure({
      db,
      baseActSourceId: BASE_SOURCE_ID,
      announcementActSourceId: ANNOUNCEMENT_A_SOURCE_ID,
      fetchMetadata,
      fetchReferences,
      fetchHtml: async () => annexHtml("Consolidated text v1."),
    });

    const second = await ingestOfficialConsolidatedStructure({
      db,
      baseActSourceId: BASE_SOURCE_ID,
      announcementActSourceId: ANNOUNCEMENT_A_SOURCE_ID,
      fetchMetadata,
      fetchReferences,
      fetchHtml: async () => annexHtml("Consolidated text v1."),
    });

    expect(second.versionAction).toBe("reused");
    expect(second.legalActVersionId).toBe(first.legalActVersionId);

    const announcementRows = await db.select().from(legalActs).where(eq(legalActs.sourceId, ANNOUNCEMENT_A_SOURCE_ID));
    expect(announcementRows).toHaveLength(1);
    const versionRows = await db
      .select()
      .from(legalActVersions)
      .where(eq(legalActVersions.sourceAnnouncementLegalActId, announcementRows[0].id));
    expect(versionRows).toHaveLength(1);
  });

  it("IMMUTABILITY: ingesting a second, different announcement for the same base act creates a NEW version and never touches the first", async () => {
    if (!db) throw new Error("unreachable");
    await insertBaseAct();

    const announcementA = await ingestOfficialConsolidatedStructure({
      db,
      baseActSourceId: BASE_SOURCE_ID,
      announcementActSourceId: ANNOUNCEMENT_A_SOURCE_ID,
      fetchMetadata: async (coords) =>
        coords.position === 93 ? baseMetadata() : announcementMetadata({ year: 2024, pos: 1061, legalStatusDate: "2024-06-19" }),
      fetchReferences: async (coords) =>
        coords.position === 93 ? referencesFor("base-correct", ANNOUNCEMENT_A_SOURCE_ID) : announcementReferencesFor("correct"),
      fetchHtml: async () => annexHtml("Consolidated text — announcement A."),
    });

    const announcementB = await ingestOfficialConsolidatedStructure({
      db,
      baseActSourceId: BASE_SOURCE_ID,
      announcementActSourceId: ANNOUNCEMENT_B_SOURCE_ID,
      fetchMetadata: async (coords) =>
        coords.position === 93 ? baseMetadata() : announcementMetadata({ year: 2026, pos: 795, legalStatusDate: "2026-05-19" }),
      fetchReferences: async (coords) =>
        coords.position === 93 ? referencesFor("base-correct", ANNOUNCEMENT_B_SOURCE_ID) : announcementReferencesFor("correct"),
      fetchHtml: async () => annexHtml("Consolidated text — announcement B."),
    });

    expect(announcementA.legalActVersionId).not.toBe(announcementB.legalActVersionId);
    expect(announcementA.announcementLegalActId).not.toBe(announcementB.announcementLegalActId);

    const [versionA] = await db.select().from(legalActVersions).where(eq(legalActVersions.id, announcementA.legalActVersionId));
    const [versionB] = await db.select().from(legalActVersions).where(eq(legalActVersions.id, announcementB.legalActVersionId));
    expect(versionA.legalStateDate).toBe("2024-06-19");
    expect(versionB.legalStateDate).toBe("2026-05-19");

    const provisionsA = await db.select().from(legalProvisions).where(eq(legalProvisions.legalActVersionId, versionA.id));
    const provisionsB = await db.select().from(legalProvisions).where(eq(legalProvisions.legalActVersionId, versionB.id));
    expect(provisionsA.some((p) => p.text.includes("announcement A"))).toBe(true);
    expect(provisionsA.some((p) => p.text.includes("announcement B"))).toBe(false);
    expect(provisionsB.some((p) => p.text.includes("announcement B"))).toBe(true);

    // Multiple `tj` rows now coexist for one base act — the whole point of this milestone.
    const allTjVersions = await db
      .select()
      .from(legalActVersions)
      .where(and(eq(legalActVersions.legalActId, versionA.legalActId), eq(legalActVersions.sourceExpressionId, "tj")));
    expect(allTjVersions.length).toBeGreaterThanOrEqual(2);
  });

  it("coexists safely with a legacy bare (non-announcement-backed) 'tj' placeholder row for the same base act", async () => {
    if (!db) throw new Error("unreachable");
    const base = await insertBaseAct();
    const [legacyTj] = await db
      .insert(legalActVersions)
      .values({
        legalActId: base.id,
        versionKind: "consolidated",
        sourceExpressionId: "tj",
        sourceDocumentKey: "expression:tj",
      })
      .returning();

    const result = await ingestOfficialConsolidatedStructure({
      db,
      baseActSourceId: BASE_SOURCE_ID,
      announcementActSourceId: ANNOUNCEMENT_A_SOURCE_ID,
      fetchMetadata: async (coords) =>
        coords.position === 93 ? baseMetadata() : announcementMetadata({ year: 2024, pos: 1061 }),
      fetchReferences: async (coords) =>
        coords.position === 93 ? referencesFor("base-correct", ANNOUNCEMENT_A_SOURCE_ID) : announcementReferencesFor("correct"),
      fetchHtml: async () => annexHtml("Consolidated text."),
    });

    expect(result.legalActVersionId).not.toBe(legacyTj.id);

    const [legacyRow] = await db.select().from(legalActVersions).where(eq(legalActVersions.id, legacyTj.id));
    expect(legacyRow.sourceAnnouncementLegalActId).toBeNull();
    const legacyProvisions = await db.select().from(legalProvisions).where(eq(legalProvisions.legalActVersionId, legacyTj.id));
    expect(legacyProvisions).toHaveLength(0);
  });

  it("SCHEMA: ogl/uj (non-announcement-backed) uniqueness is still protected by the DB", async () => {
    if (!db) throw new Error("unreachable");
    const base = await insertBaseAct();
    await db.insert(legalActVersions).values({
      legalActId: base.id,
      versionKind: "promulgated",
      sourceExpressionId: "ogl",
      sourceDocumentKey: "expression:ogl",
    });

    await expect(
      db.insert(legalActVersions).values({
        legalActId: base.id,
        versionKind: "promulgated",
        sourceExpressionId: "ogl",
        sourceDocumentKey: "expression:ogl:duplicate",
      }),
    ).rejects.toThrow();
  });

  it("SCHEMA: the SAME announcement cannot create a duplicate TJ version even via a raw duplicate insert", async () => {
    if (!db) throw new Error("unreachable");
    const base = await insertBaseAct();
    const [announcement] = await db
      .insert(legalActs)
      .values({ jurisdiction: "PL", source: ELI_SOURCE, sourceId: ANNOUNCEMENT_A_SOURCE_ID, title: "Announcement", actType: "Obwieszczenie" })
      .returning();

    await db.insert(legalActVersions).values({
      legalActId: base.id,
      versionKind: "consolidated",
      sourceExpressionId: "tj",
      sourceAnnouncementLegalActId: announcement.id,
      sourceDocumentKey: "announcement:first",
    });

    await expect(
      db.insert(legalActVersions).values({
        legalActId: base.id,
        versionKind: "consolidated",
        sourceExpressionId: "tj",
        sourceAnnouncementLegalActId: announcement.id,
        sourceDocumentKey: "announcement:second",
      }),
    ).rejects.toThrow();
  });

  it("rejects a destructive shrink for a re-ingested announcement, exactly like ingestActStructure", async () => {
    if (!db) throw new Error("unreachable");
    await insertBaseAct();

    const fetchMetadata = async (coords: { position: number }) =>
      coords.position === 93 ? baseMetadata() : announcementMetadata({ year: 2024, pos: 1061 });
    const fetchReferences = async (coords: { position: number }) =>
      coords.position === 93 ? referencesFor("base-correct", ANNOUNCEMENT_A_SOURCE_ID) : announcementReferencesFor("correct");

    function annexWithArticles(count: number): string {
      const articles = Array.from(
        { length: count },
        (_, i) => `
          <div class="unit unit_arti pro-text false" id="arti_${i + 1}" data-id="arti_${i + 1}">
            <h3 CLASS="pro-none"><B CLASS="b">Art.&nbsp;${i + 1}.</B></h3>
            <div class="unit-inner"><div data-template="xText" CLASS="pro-text">Treść art. ${i + 1}.</div></div>
          </div>`,
      ).join("\n");
      return `<!DOCTYPE HTML><html><body><div class="parts">
        <section id="part_1"><div class="part" id="_001"><h2 class="part"><span class=" ">Treść obwieszczenia</span></h2><div class="block"></div></div></section>
        <section id="part_2"><div class="part" id="_002"><h2 class="part"><span class=" ">Załącznik - Tekst jednolity ustawy testowej</span></h2><div class="block">${articles}</div></div></section>
      </div></body></html>`;
    }

    await ingestOfficialConsolidatedStructure({
      db,
      baseActSourceId: BASE_SOURCE_ID,
      announcementActSourceId: ANNOUNCEMENT_A_SOURCE_ID,
      fetchMetadata,
      fetchReferences,
      fetchHtml: async () => annexWithArticles(10),
    });

    const attempt = ingestOfficialConsolidatedStructure({
      db,
      baseActSourceId: BASE_SOURCE_ID,
      announcementActSourceId: ANNOUNCEMENT_A_SOURCE_ID,
      fetchMetadata,
      fetchReferences,
      fetchHtml: async () => annexWithArticles(3),
    });

    await expect(attempt).rejects.toThrow(DestructiveShrinkError);
  });
});
