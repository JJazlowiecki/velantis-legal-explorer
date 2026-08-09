import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { explorerSavedItems, legalActResources, legalActVersions, legalActs, legalProvisions } from "../../../db/schema";
import { createTestDatabase } from "../../test-support/test-db";
import { buildContentKey } from "../saved/content-key";
import { createSavedItem, getSavedItem } from "../saved/service";
import {
  getLegalAct,
  getLegalActStructure,
  getLegalProvision,
  listLegalActFilterOptions,
  listLegalActs,
} from "./service";

const testDatabase = createTestDatabase();
const describeDatabase = testDatabase ? describe : describe.skip;
const client = testDatabase?.client;
const db = testDatabase?.db;

const TEST_SOURCE = "test_fixture";

async function insertAct(overrides: Partial<typeof legalActs.$inferInsert> = {}) {
  if (!db) throw new Error("unreachable");
  const [row] = await db
    .insert(legalActs)
    .values({
      jurisdiction: "PL",
      source: TEST_SOURCE,
      sourceId: overrides.sourceId ?? `TEST/${Math.random()}`,
      title: "Ustawa testowa",
      actType: "Ustawa",
      publisher: "DU",
      journalYear: 1999,
      journalPosition: 1,
      eliUri: "DU/1999/1",
      officialPageUrl: "https://api.sejm.gov.pl/eli/acts/DU/1999/1",
      ...overrides,
    })
    .returning();
  return row;
}

async function insertVersion(legalActId: string, overrides: Partial<typeof legalActVersions.$inferInsert> = {}) {
  if (!db) throw new Error("unreachable");
  const [row] = await db
    .insert(legalActVersions)
    .values({
      legalActId,
      versionKind: "promulgated",
      sourceExpressionId: "ogl",
      canonicalEliUri: "https://eli.gov.pl/eli/DU/1999/1/ogl",
      authorityClass: "authoritative",
      nonAuthoritative: false,
      currentnessStatus: "unproven",
      sourceDocumentKey: `expression:${overrides.sourceExpressionId ?? "ogl"}:${Math.random()}`,
      ...overrides,
    })
    .returning();
  return row;
}

async function insertProvision(legalActVersionId: string, overrides: Partial<typeof legalProvisions.$inferInsert> = {}) {
  if (!db) throw new Error("unreachable");
  const [row] = await db
    .insert(legalProvisions)
    .values({
      legalActVersionId,
      provisionType: "article",
      citationLabel: "art. 1",
      text: "Art. 1. Treść przepisu testowego.",
      structuralPath: `art_${Math.random()}`,
      ordinal: 1,
      ...overrides,
    })
    .returning();
  return row;
}

async function insertResource(legalActId: string, legalActVersionId: string | null, overrides: Partial<typeof legalActResources.$inferInsert> = {}) {
  if (!db) throw new Error("unreachable");
  const [row] = await db
    .insert(legalActResources)
    .values({
      legalActId,
      legalActVersionId,
      sourceTypeCodes: "H",
      representationType: "html",
      fileName: "text.html",
      sourceUrl: `https://example.test/${Math.random()}`,
      ...overrides,
    })
    .returning();
  return row;
}

afterAll(async () => {
  await client?.end({ timeout: 1 });
});

describeDatabase("legal-acts service", () => {
  beforeEach(async () => {
    if (!db) return;
    // legal_act_versions/legal_act_resources/legal_provisions all cascade-delete via FK.
    await db.delete(legalActs).where(eq(legalActs.source, TEST_SOURCE));
  });

  it("lists real acts for a jurisdiction", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct({ title: "Kodeks testowy", sourceId: "TEST/1" });

    const items = await listLegalActs({ db, jurisdiction: "PL" });

    expect(items.some((item) => item.id === act.id && item.title === "Kodeks testowy")).toBe(true);
  });

  it("browsing does not require any visitor identity — listLegalActs takes no visitor parameter", async () => {
    if (!db) throw new Error("unreachable");
    await insertAct({ sourceId: "TEST/no-visitor" });
    // No visitorId is passed anywhere in this call — public metadata browsing.
    const items = await listLegalActs({ db, jurisdiction: "PL" });
    expect(Array.isArray(items)).toBe(true);
  });

  it("searches by title (case-insensitive substring)", async () => {
    if (!db) throw new Error("unreachable");
    await insertAct({ title: "Kodeks postępowania administracyjnego", sourceId: "TEST/kpa" });
    await insertAct({ title: "Kodeks cywilny", sourceId: "TEST/kc" });

    const items = await listLegalActs({ db, jurisdiction: "PL", searchTerm: "administracyjnego" });

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Kodeks postępowania administracyjnego");
  });

  it("filters by publication year", async () => {
    if (!db) throw new Error("unreachable");
    await insertAct({ journalYear: 1964, sourceId: "TEST/1964" });
    await insertAct({ journalYear: 1997, sourceId: "TEST/1997" });

    const items = await listLegalActs({ db, jurisdiction: "PL", journalYear: 1964 });

    expect(items.every((item) => item.journalYear === 1964)).toBe(true);
    expect(items.some((item) => item.journalYear === 1997)).toBe(false);
  });

  it("filters by act type", async () => {
    if (!db) throw new Error("unreachable");
    await insertAct({ actType: "Ustawa", sourceId: "TEST/ustawa" });
    await insertAct({ actType: "Rozporządzenie", sourceId: "TEST/rozp" });

    const items = await listLegalActs({ db, jurisdiction: "PL", actType: "Rozporządzenie" });

    expect(items.every((item) => item.actType === "Rozporządzenie")).toBe(true);
  });

  it("populates filter options from the full unfiltered set", async () => {
    if (!db) throw new Error("unreachable");
    await insertAct({ actType: "Ustawa", publisher: "DU", journalYear: 2001, sourceId: "TEST/opt1" });

    const options = await listLegalActFilterOptions({ db, jurisdiction: "PL" });

    expect(options.actTypes).toContain("Ustawa");
    expect(options.publishers).toContain("DU");
    expect(options.journalYears).toContain(2001);
  });

  it("getLegalAct returns the act with its versions", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct({ sourceId: "TEST/withversions" });
    await insertVersion(act.id, { versionKind: "promulgated", sourceExpressionId: "ogl" });
    await insertVersion(act.id, { versionKind: "consolidated", sourceExpressionId: "tj", canonicalEliUri: "https://eli.gov.pl/eli/DU/1999/1/tj" });

    const detail = await getLegalAct({ db, id: act.id });

    expect(detail).not.toBeNull();
    expect(detail?.versions).toHaveLength(2);
  });

  it("returns null for a nonexistent or malformed act id (safe not-found)", async () => {
    if (!db) throw new Error("unreachable");
    const detail = await getLegalAct({ db, id: "00000000-0000-4000-8000-000000000000" });
    expect(detail).toBeNull();
  });

  it("preserves UJ as non-authoritative through the full read path", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct({ sourceId: "TEST/uj" });
    await insertVersion(act.id, {
      versionKind: "unified",
      sourceExpressionId: "uj",
      authorityClass: "non_authoritative",
      nonAuthoritative: true,
    });

    const detail = await getLegalAct({ db, id: act.id });

    expect(detail?.versions[0].authorityClass).toBe("non_authoritative");
    expect(detail?.versions[0].nonAuthoritative).toBe(true);
  });

  it("never fabricates proven currentness for a historical promulgated (ogl) version", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct({ sourceId: "TEST/historical-ogl", journalYear: 1964 });
    await insertVersion(act.id, { versionKind: "promulgated", sourceExpressionId: "ogl", currentnessStatus: "unproven" });

    const detail = await getLegalAct({ db, id: act.id });

    expect(detail?.versions[0].currentnessStatus).toBe("unproven");
    expect(detail?.versions[0].currentnessStatus).not.toBe("proven_current");
  });

  it("maps resolved resources to the correct version and unresolved resources separately", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct({ sourceId: "TEST/resources" });
    const version = await insertVersion(act.id);
    await insertResource(act.id, version.id, { representationType: "eli_expression", fileName: "ogl.eli", sourceUrl: "https://eli.gov.pl/eli/DU/1999/1/ogl" });
    await insertResource(act.id, null, { representationType: "pdf", fileName: "raw.pdf", sourceUrl: "https://example.test/raw.pdf" });

    const detail = await getLegalAct({ db, id: act.id });

    expect(detail?.versions[0].resources).toHaveLength(1);
    expect(detail?.versions[0].resources[0].sourceUrl).toContain("ogl");
    expect(detail?.unresolvedResources).toHaveLength(1);
    expect(detail?.unresolvedResources[0].fileName).toBe("raw.pdf");
  });

  it("builds table-of-contents structure ordered by ordinal, without provision text", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct({ sourceId: "TEST/toc" });
    const version = await insertVersion(act.id);
    await insertProvision(version.id, { citationLabel: "Dział I", provisionType: "division", ordinal: 1, structuralPath: "div_1" });
    await insertProvision(version.id, { citationLabel: "art. 2", ordinal: 3, structuralPath: "art_2" });
    await insertProvision(version.id, { citationLabel: "art. 1", ordinal: 2, structuralPath: "art_1" });

    const structure = await getLegalActStructure({ db, legalActVersionId: version.id });

    expect(structure).not.toBeNull();
    expect(structure?.map((n) => n.citationLabel)).toEqual(["Dział I", "art. 1", "art. 2"]);
    expect(structure?.every((n) => !("text" in n))).toBe(true);
  });

  it("returns [] (not null) for a version that exists but has no structured provisions", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct({ sourceId: "TEST/no-structure" });
    const version = await insertVersion(act.id);

    const structure = await getLegalActStructure({ db, legalActVersionId: version.id });

    expect(structure).toEqual([]);
  });

  it("returns null for a nonexistent version id", async () => {
    if (!db) throw new Error("unreachable");
    const structure = await getLegalActStructure({ db, legalActVersionId: "00000000-0000-4000-8000-000000000000" });
    expect(structure).toBeNull();
  });

  it("fetches full provision text and hierarchy separately from the table of contents", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct({ sourceId: "TEST/provision-detail" });
    const version = await insertVersion(act.id);
    const chapter = await insertProvision(version.id, {
      citationLabel: "Rozdział 1",
      heading: "Rozdział 1 - Zasady ogólne",
      provisionType: "chapter",
      ordinal: 1,
      structuralPath: "ch_1",
    });
    const article = await insertProvision(version.id, {
      citationLabel: "art. 1",
      heading: "Art. 1.",
      text: "Art. 1. Pełna treść przepisu.",
      parentProvisionId: chapter.id,
      ordinal: 2,
      structuralPath: "ch_1/art_1",
    });

    const detail = await getLegalProvision({ db, legalActVersionId: version.id, provisionId: article.id });

    expect(detail).not.toBeNull();
    expect(detail?.text).toBe("Art. 1. Pełna treść przepisu.");
    expect(detail?.ancestors).toEqual([{ id: chapter.id, citationLabel: "Rozdział 1", heading: "Rozdział 1 - Zasady ogólne" }]);
  });

  it("a provision cannot be retrieved through a different version (selected-version ownership enforced)", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct({ sourceId: "TEST/cross-version" });
    const versionA = await insertVersion(act.id, { sourceExpressionId: "ogl" });
    const versionB = await insertVersion(act.id, { sourceExpressionId: "tj", versionKind: "consolidated" });
    const provisionInA = await insertProvision(versionA.id);

    const throughWrongVersion = await getLegalProvision({ db, legalActVersionId: versionB.id, provisionId: provisionInA.id });
    const throughRightVersion = await getLegalProvision({ db, legalActVersionId: versionA.id, provisionId: provisionInA.id });

    expect(throughWrongVersion).toBeNull();
    expect(throughRightVersion).not.toBeNull();
  });

  it("returns null for a nonexistent provision id within a real version", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct({ sourceId: "TEST/missing-provision" });
    const version = await insertVersion(act.id);

    const detail = await getLegalProvision({ db, legalActVersionId: version.id, provisionId: "00000000-0000-4000-8000-000000000000" });

    expect(detail).toBeNull();
  });
});

describeDatabase("Save-provision integration (reuses the existing Saved service)", () => {
  const VISITOR = "55555555-5555-4555-8555-555555555555";

  beforeEach(async () => {
    if (!db) return;
    await db.delete(legalActs).where(eq(legalActs.source, TEST_SOURCE));
    await db.delete(explorerSavedItems).where(eq(explorerSavedItems.visitorId, VISITOR));
  });

  it("a provision opened from Legal Acts can be saved through the existing, unmodified Saved service", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct({ title: "Ustawa testowa do zapisu", sourceId: "TEST/save" });
    const version = await insertVersion(act.id, { versionKind: "consolidated", sourceExpressionId: "tj", authorityClass: "authoritative" });
    const provisionRow = await insertProvision(version.id, { citationLabel: "art. 5", text: "Art. 5. Treść do zapisania." });

    const detail = await getLegalProvision({ db, legalActVersionId: version.id, provisionId: provisionRow.id });
    if (!detail) throw new Error("unreachable");

    // Exactly the shape src/app/explorer/saved/actions.ts's saveProvisionFromPayload builds
    // and validates before calling createSavedItem — proving no parallel Saved implementation
    // is needed for Legal Acts.
    const snapshot = {
      actTitle: act.title,
      citationLabel: detail.citationLabel,
      text: detail.text,
      isNonAuthoritative: false,
      isCurrentnessUnproven: true,
    };

    const result = await createSavedItem({
      db,
      visitorId: VISITOR,
      kind: "provision",
      title: `${snapshot.citationLabel} — ${snapshot.actTitle}`,
      snapshot,
      contentKey: buildContentKey("provision", `${snapshot.actTitle}|${snapshot.citationLabel}|${snapshot.text}`),
      maxItems: 100,
    });

    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("unreachable");

    const saved = await getSavedItem({ db, visitorId: VISITOR, id: result.id });
    expect(saved?.snapshot).toEqual(snapshot);
  });
});
