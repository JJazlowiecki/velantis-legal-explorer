import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { legalActVersions, legalActs, legalProvisions } from "../../../db/schema";
import { createTestDatabase } from "../../test-support/test-db";
import { DestructiveShrinkError, ingestActStructure, SHRINK_GUARD_MAX_DROP_RATIO, StructureIngestError } from "./structure-ingest";

const testDatabase = createTestDatabase();
const describeDatabase = testDatabase ? describe : describe.skip;
const client = testDatabase?.client;
const db = testDatabase?.db;

const TEST_SOURCE = "structure_ingest_test_fixture";

const SIMPLE_DOCUMENT = `<!DOCTYPE HTML><html><body>
  <div class="parts">
    <section id="part_1">
      <div class="part" id="_001">
        <h2 class="part"><span class="hidden">Treść ustawy</span></h2>
        <div class="block">
          <div class="unit unit_arti pro-text false" id="arti_1" data-id="arti_1">
            <h3 CLASS="pro-none"><B CLASS="b">Art.&nbsp;1.</B></h3>
            <div class="unit-inner"><div data-template="xText" CLASS="pro-text">Treść.</div></div>
          </div>
        </div>
      </div>
    </section>
  </div>
</body></html>`;

/** A minimal-but-real ELI document with `count` direct-text articles, for exercising the shrink guard at a realistic scale. */
function buildDocumentWithArticles(count: number): string {
  const articles = Array.from(
    { length: count },
    (_, i) => `
      <div class="unit unit_arti pro-text false" id="arti_${i + 1}" data-id="arti_${i + 1}">
        <h3 CLASS="pro-none"><B CLASS="b">Art.&nbsp;${i + 1}.</B></h3>
        <div class="unit-inner"><div data-template="xText" CLASS="pro-text">Treść art. ${i + 1}.</div></div>
      </div>
    `,
  ).join("\n");

  return `<!DOCTYPE HTML><html><body>
    <div class="parts">
      <section id="part_1">
        <div class="part" id="_001">
          <h2 class="part"><span class="hidden">Treść ustawy</span></h2>
          <div class="block">${articles}</div>
        </div>
      </section>
    </div>
  </body></html>`;
}

async function insertAct(sourceId: string) {
  if (!db) throw new Error("unreachable");
  const [row] = await db
    .insert(legalActs)
    .values({ jurisdiction: "PL", source: TEST_SOURCE, sourceId, title: "Ustawa testowa", actType: "Ustawa" })
    .returning();
  return row;
}

async function insertVersion(legalActId: string, sourceExpressionId: string) {
  if (!db) throw new Error("unreachable");
  const [row] = await db
    .insert(legalActVersions)
    .values({ legalActId, versionKind: "promulgated", sourceExpressionId, sourceDocumentKey: `expr:${sourceExpressionId}:${Math.random()}` })
    .returning();
  return row;
}

afterAll(async () => {
  await client?.end({ timeout: 1 });
});

describeDatabase("ingestActStructure", () => {
  beforeEach(async () => {
    if (!db) return;
    await db.delete(legalActs).where(eq(legalActs.source, TEST_SOURCE));
  });

  it("inserts parsed provisions into the existing matching version", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct("TEST/1");
    const version = await insertVersion(act.id, "ogl");

    const result = await ingestActStructure({ db, source: TEST_SOURCE, sourceId: "TEST/1", sourceExpressionId: "ogl", html: SIMPLE_DOCUMENT });

    expect(result.legalActVersionId).toBe(version.id);
    expect(result.insertedCount).toBe(2); // root "part" + 1 article
    const rows = await db.select().from(legalProvisions).where(eq(legalProvisions.legalActVersionId, version.id));
    expect(rows).toHaveLength(2);
  });

  it("never creates a new version — throws when the source expression id doesn't already exist", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct("TEST/no-version");
    await insertVersion(act.id, "ogl");

    await expect(
      ingestActStructure({ db, source: TEST_SOURCE, sourceId: "TEST/no-version", sourceExpressionId: "tj", html: SIMPLE_DOCUMENT }),
    ).rejects.toThrow(StructureIngestError);

    const versions = await db.select().from(legalActVersions).where(eq(legalActVersions.legalActId, act.id));
    expect(versions).toHaveLength(1);
  });

  it("is idempotent: re-ingesting the same HTML replaces rather than duplicates", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct("TEST/idempotent");
    const version = await insertVersion(act.id, "ogl");

    await ingestActStructure({ db, source: TEST_SOURCE, sourceId: "TEST/idempotent", sourceExpressionId: "ogl", html: SIMPLE_DOCUMENT });
    const second = await ingestActStructure({ db, source: TEST_SOURCE, sourceId: "TEST/idempotent", sourceExpressionId: "ogl", html: SIMPLE_DOCUMENT });

    expect(second.deletedCount).toBe(2);
    expect(second.insertedCount).toBe(2);
    const rows = await db.select().from(legalProvisions).where(eq(legalProvisions.legalActVersionId, version.id));
    expect(rows).toHaveLength(2);
  });

  it("never touches a sibling version's provisions (e.g. re-ingesting ogl leaves tj untouched)", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct("TEST/sibling");
    const oglVersion = await insertVersion(act.id, "ogl");
    const tjVersion = await insertVersion(act.id, "tj");
    await db.insert(legalProvisions).values({
      legalActVersionId: tjVersion.id,
      provisionType: "article",
      citationLabel: "art. 1",
      text: "TJ text — must survive.",
      structuralPath: "tj_arti_1",
      ordinal: 1,
    });

    await ingestActStructure({ db, source: TEST_SOURCE, sourceId: "TEST/sibling", sourceExpressionId: "ogl", html: SIMPLE_DOCUMENT });

    const tjRows = await db.select().from(legalProvisions).where(eq(legalProvisions.legalActVersionId, tjVersion.id));
    expect(tjRows).toHaveLength(1);
    expect(tjRows[0].text).toBe("TJ text — must survive.");

    const oglRows = await db.select().from(legalProvisions).where(eq(legalProvisions.legalActVersionId, oglVersion.id));
    expect(oglRows).toHaveLength(2);
  });

  it("refuses to wipe existing structure when the HTML parses to zero provisions", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct("TEST/empty-html");
    const version = await insertVersion(act.id, "ogl");
    await ingestActStructure({ db, source: TEST_SOURCE, sourceId: "TEST/empty-html", sourceExpressionId: "ogl", html: SIMPLE_DOCUMENT });

    await expect(
      ingestActStructure({ db, source: TEST_SOURCE, sourceId: "TEST/empty-html", sourceExpressionId: "ogl", html: "<html><body>no act here</body></html>" }),
    ).rejects.toThrow(StructureIngestError);

    const rows = await db.select().from(legalProvisions).where(eq(legalProvisions.legalActVersionId, version.id));
    expect(rows).toHaveLength(2);
  });

  it("throws for a nonexistent act", async () => {
    if (!db) throw new Error("unreachable");
    await expect(
      ingestActStructure({ db, source: TEST_SOURCE, sourceId: "TEST/does-not-exist", sourceExpressionId: "ogl", html: SIMPLE_DOCUMENT }),
    ).rejects.toThrow(StructureIngestError);
  });

  it("only ever matches the LEGACY (non-announcement-backed) 'tj' alias, never an immutable announcement-backed 'tj' version, even though both share sourceExpressionId", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct("TEST/multi-tj");
    const legacyTj = await insertVersion(act.id, "tj");

    const [announcement] = await db
      .insert(legalActs)
      .values({ jurisdiction: "PL", source: TEST_SOURCE, sourceId: "TEST/announcement-1", title: "Announcement", actType: "Obwieszczenie" })
      .returning();
    const [announcementBackedTj] = await db
      .insert(legalActVersions)
      .values({
        legalActId: act.id,
        versionKind: "consolidated",
        sourceExpressionId: "tj",
        sourceAnnouncementLegalActId: announcement.id,
        sourceDocumentKey: "announcement:TEST/announcement-1",
      })
      .returning();
    await db.insert(legalProvisions).values({
      legalActVersionId: announcementBackedTj.id,
      provisionType: "article",
      citationLabel: "art. 1",
      text: "Immutable announcement-backed text — must survive.",
      structuralPath: "arti_1",
      ordinal: 1,
    });

    const result = await ingestActStructure({ db, source: TEST_SOURCE, sourceId: "TEST/multi-tj", sourceExpressionId: "tj", html: SIMPLE_DOCUMENT });

    expect(result.legalActVersionId).toBe(legacyTj.id);
    expect(result.legalActVersionId).not.toBe(announcementBackedTj.id);

    const announcementRows = await db.select().from(legalProvisions).where(eq(legalProvisions.legalActVersionId, announcementBackedTj.id));
    expect(announcementRows).toHaveLength(1);
    expect(announcementRows[0].text).toBe("Immutable announcement-backed text — must survive.");
  });

  it("throws (rather than picking an announcement-backed version) when only announcement-backed 'tj' rows exist and no legacy alias does", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct("TEST/only-announcement-tj");
    const [announcement] = await db
      .insert(legalActs)
      .values({ jurisdiction: "PL", source: TEST_SOURCE, sourceId: "TEST/announcement-2", title: "Announcement", actType: "Obwieszczenie" })
      .returning();
    await db.insert(legalActVersions).values({
      legalActId: act.id,
      versionKind: "consolidated",
      sourceExpressionId: "tj",
      sourceAnnouncementLegalActId: announcement.id,
      sourceDocumentKey: "announcement:TEST/announcement-2",
    });

    await expect(
      ingestActStructure({ db, source: TEST_SOURCE, sourceId: "TEST/only-announcement-tj", sourceExpressionId: "tj", html: SIMPLE_DOCUMENT }),
    ).rejects.toThrow(StructureIngestError);
  });
});

describeDatabase("ingestActStructure — destructive-shrink guard", () => {
  beforeEach(async () => {
    if (!db) return;
    await db.delete(legalActs).where(eq(legalActs.source, TEST_SOURCE));
  });

  it("identical re-ingestion succeeds (10 -> 10, no shrink at all)", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct("TEST/shrink-identical");
    const version = await insertVersion(act.id, "ogl");
    const doc = buildDocumentWithArticles(10);

    await ingestActStructure({ db, source: TEST_SOURCE, sourceId: "TEST/shrink-identical", sourceExpressionId: "ogl", html: doc });
    const second = await ingestActStructure({ db, source: TEST_SOURCE, sourceId: "TEST/shrink-identical", sourceExpressionId: "ogl", html: doc });

    expect(second.insertedCount).toBe(11); // root "part" + 10 articles
    const rows = await db.select().from(legalProvisions).where(eq(legalProvisions.legalActVersionId, version.id));
    expect(rows).toHaveLength(11);
  });

  it("a small, within-threshold drop (11 -> 10, ~9%) is treated as a legitimate/no-op-ish difference and succeeds", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct("TEST/shrink-small");
    const version = await insertVersion(act.id, "ogl");

    await ingestActStructure({ db, source: TEST_SOURCE, sourceId: "TEST/shrink-small", sourceExpressionId: "ogl", html: buildDocumentWithArticles(10) });
    const second = await ingestActStructure({
      db,
      source: TEST_SOURCE,
      sourceId: "TEST/shrink-small",
      sourceExpressionId: "ogl",
      html: buildDocumentWithArticles(9),
    });

    expect(second.deletedCount).toBe(11);
    expect(second.insertedCount).toBe(10); // root + 9 articles — an ~9% drop, well within the 20% threshold
    const rows = await db.select().from(legalProvisions).where(eq(legalProvisions.legalActVersionId, version.id));
    expect(rows).toHaveLength(10);
  });

  it("a materially smaller non-zero parse (11 -> 6, ~45% drop) is rejected before any deletion", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct("TEST/shrink-reject");
    const version = await insertVersion(act.id, "ogl");

    await ingestActStructure({ db, source: TEST_SOURCE, sourceId: "TEST/shrink-reject", sourceExpressionId: "ogl", html: buildDocumentWithArticles(10) });

    const attempt = ingestActStructure({
      db,
      source: TEST_SOURCE,
      sourceId: "TEST/shrink-reject",
      sourceExpressionId: "ogl",
      html: buildDocumentWithArticles(5), // root + 5 = 6, vs existing 11
    });

    await expect(attempt).rejects.toThrow(DestructiveShrinkError);
    await expect(attempt).rejects.toMatchObject({ existingCount: 11, parsedCount: 6, maxDropRatio: SHRINK_GUARD_MAX_DROP_RATIO });

    // No DELETE, no partial mutation — all 11 original rows are still exactly as they were.
    const rows = await db.select().from(legalProvisions).where(eq(legalProvisions.legalActVersionId, version.id));
    expect(rows).toHaveLength(11);
  });

  it("the explicit override (allowDestructiveShrink) permits the replacement when deliberately requested", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct("TEST/shrink-override");
    const version = await insertVersion(act.id, "ogl");

    await ingestActStructure({ db, source: TEST_SOURCE, sourceId: "TEST/shrink-override", sourceExpressionId: "ogl", html: buildDocumentWithArticles(10) });

    const result = await ingestActStructure({
      db,
      source: TEST_SOURCE,
      sourceId: "TEST/shrink-override",
      sourceExpressionId: "ogl",
      html: buildDocumentWithArticles(5),
      allowDestructiveShrink: true,
    });

    expect(result.deletedCount).toBe(11);
    expect(result.insertedCount).toBe(6);
    const rows = await db.select().from(legalProvisions).where(eq(legalProvisions.legalActVersionId, version.id));
    expect(rows).toHaveLength(6);
  });

  it("a rejected shrink never touches a sibling version's provisions", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct("TEST/shrink-sibling");
    const oglVersion = await insertVersion(act.id, "ogl");
    const tjVersion = await insertVersion(act.id, "tj");
    await ingestActStructure({ db, source: TEST_SOURCE, sourceId: "TEST/shrink-sibling", sourceExpressionId: "ogl", html: buildDocumentWithArticles(10) });
    await db.insert(legalProvisions).values({
      legalActVersionId: tjVersion.id,
      provisionType: "article",
      citationLabel: "art. 1",
      text: "TJ text — must survive a rejected ogl shrink.",
      structuralPath: "tj_arti_1",
      ordinal: 1,
    });

    await expect(
      ingestActStructure({ db, source: TEST_SOURCE, sourceId: "TEST/shrink-sibling", sourceExpressionId: "ogl", html: buildDocumentWithArticles(3) }),
    ).rejects.toThrow(DestructiveShrinkError);

    const tjRows = await db.select().from(legalProvisions).where(eq(legalProvisions.legalActVersionId, tjVersion.id));
    expect(tjRows).toHaveLength(1);
    const oglRows = await db.select().from(legalProvisions).where(eq(legalProvisions.legalActVersionId, oglVersion.id));
    expect(oglRows).toHaveLength(11);
  });

  it("the shrink guard does not apply when there are zero existing provisions (first ingestion of any size succeeds)", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct("TEST/shrink-first-run");
    const version = await insertVersion(act.id, "ogl");

    const result = await ingestActStructure({
      db,
      source: TEST_SOURCE,
      sourceId: "TEST/shrink-first-run",
      sourceExpressionId: "ogl",
      html: buildDocumentWithArticles(2),
    });

    expect(result.insertedCount).toBe(3);
    const rows = await db.select().from(legalProvisions).where(eq(legalProvisions.legalActVersionId, version.id));
    expect(rows).toHaveLength(3);
  });
});
