import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { legalActVersions, legalActs, legalProvisions, legalSearchDocuments } from "../../../db/schema";
import { createTestDatabase } from "../../test-support/test-db";
import type { EmbedTextsFn } from "./embeddings";
import { indexLegalSearchDocuments } from "./indexing";

const testDatabase = createTestDatabase();
const describeDatabase = testDatabase ? describe : describe.skip;
const client = testDatabase?.client;
const db = testDatabase?.db;

const TEST_SOURCE = "indexing_isolation_test_fixture";

const DIMENSIONS = 1536;
const fakeEmbed: EmbedTextsFn = async (texts) =>
  texts.map((text) => {
    const vector = new Array<number>(DIMENSIONS).fill(0);
    vector[0] = text.length;
    return vector;
  });

async function insertAct(sourceId: string, title = "Test act") {
  if (!db) throw new Error("unreachable");
  const [row] = await db
    .insert(legalActs)
    .values({ jurisdiction: "PL", source: TEST_SOURCE, sourceId, title, actType: "Ustawa" })
    .returning();
  return row;
}

async function insertAnnouncementBackedVersion(legalActId: string, announcementSourceId: string, legalStateDate: string) {
  if (!db) throw new Error("unreachable");
  const announcement = await insertAct(announcementSourceId, "Obwieszczenie");
  const [version] = await db
    .insert(legalActVersions)
    .values({
      legalActId,
      versionKind: "consolidated",
      sourceExpressionId: "tj",
      sourceAnnouncementLegalActId: announcement.id,
      legalStateDate,
      sourceDocumentKey: `announcement:${announcementSourceId}`,
    })
    .returning();
  return version;
}

afterAll(async () => {
  await client?.end({ timeout: 1 });
});

describeDatabase("indexLegalSearchDocuments — multi-TJ isolation", () => {
  beforeEach(async () => {
    if (!db) return;
    await db.delete(legalActs).where(eq(legalActs.source, TEST_SOURCE));
  });

  it("indexing two announcement-backed TJ versions of the SAME base act keeps their search documents fully isolated", async () => {
    if (!db) throw new Error("unreachable");
    const base = await insertAct("TEST/base-1");
    const versionA = await insertAnnouncementBackedVersion(base.id, "TEST/announcement-A", "2023-07-28");
    const versionB = await insertAnnouncementBackedVersion(base.id, "TEST/announcement-B", "2024-06-19");

    await db.insert(legalProvisions).values({
      legalActVersionId: versionA.id,
      provisionType: "article",
      citationLabel: "art. 1",
      text: "Treść wg wersji A — KEYWORD_A.",
      structuralPath: "arti_1",
      ordinal: 1,
    });
    await db.insert(legalProvisions).values({
      legalActVersionId: versionB.id,
      provisionType: "article",
      citationLabel: "art. 1",
      text: "Treść wg wersji B — KEYWORD_B.",
      structuralPath: "arti_1",
      ordinal: 1,
    });

    const resultA = await indexLegalSearchDocuments(versionA.id, { db, embedTexts: fakeEmbed });
    const resultB = await indexLegalSearchDocuments(versionB.id, { db, embedTexts: fakeEmbed });

    expect(resultA.searchDocuments).toBe(1);
    expect(resultB.searchDocuments).toBe(1);

    const docsA = await db.select().from(legalSearchDocuments).where(eq(legalSearchDocuments.legalActVersionId, versionA.id));
    const docsB = await db.select().from(legalSearchDocuments).where(eq(legalSearchDocuments.legalActVersionId, versionB.id));

    expect(docsA).toHaveLength(1);
    expect(docsB).toHaveLength(1);
    expect(docsA[0].content).toContain("KEYWORD_A");
    expect(docsA[0].content).not.toContain("KEYWORD_B");
    expect(docsB[0].content).toContain("KEYWORD_B");
    expect(docsB[0].content).not.toContain("KEYWORD_A");
  });

  it("re-indexing one announcement-backed TJ version never deletes or updates another TJ version's search documents, even for the same citation_label", async () => {
    if (!db) throw new Error("unreachable");
    const base = await insertAct("TEST/base-2");
    const versionA = await insertAnnouncementBackedVersion(base.id, "TEST/announcement-C", "2023-07-28");
    const versionB = await insertAnnouncementBackedVersion(base.id, "TEST/announcement-D", "2024-06-19");

    const [provisionA] = await db
      .insert(legalProvisions)
      .values({
        legalActVersionId: versionA.id,
        provisionType: "article",
        citationLabel: "art. 5",
        text: "Wersja A, art. 5 — treść pierwotna.",
        structuralPath: "arti_5",
        ordinal: 1,
      })
      .returning();
    await db.insert(legalProvisions).values({
      legalActVersionId: versionB.id,
      provisionType: "article",
      citationLabel: "art. 5",
      text: "Wersja B, art. 5 — inna treść.",
      structuralPath: "arti_5",
      ordinal: 1,
    });

    await indexLegalSearchDocuments(versionA.id, { db, embedTexts: fakeEmbed });
    await indexLegalSearchDocuments(versionB.id, { db, embedTexts: fakeEmbed });
    const docsBBefore = await db.select().from(legalSearchDocuments).where(eq(legalSearchDocuments.legalActVersionId, versionB.id));

    // Change version A's provision text and re-index ONLY version A.
    await db.update(legalProvisions).set({ text: "Wersja A, art. 5 — treść zmieniona." }).where(eq(legalProvisions.id, provisionA.id));
    await indexLegalSearchDocuments(versionA.id, { db, embedTexts: fakeEmbed });

    const docsA = await db.select().from(legalSearchDocuments).where(eq(legalSearchDocuments.legalActVersionId, versionA.id));
    const docsBAfter = await db.select().from(legalSearchDocuments).where(eq(legalSearchDocuments.legalActVersionId, versionB.id));

    expect(docsA[0].content).toContain("treść zmieniona");
    expect(docsBAfter).toEqual(docsBBefore);
    expect(docsBAfter[0].content).toContain("inna treść");
  });
});
