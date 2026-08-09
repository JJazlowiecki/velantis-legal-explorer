import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { legalActRelations, legalActResources, legalActs, legalActVersions, legalProvisions } from "../../../db/schema";
import { createTestDatabase } from "../../test-support/test-db";
import fixture from "./__fixtures__/du-1964-93.json";
import type { DiscoveredOfficialExpression } from "./expressions";
import { ingestEliActMetadata } from "./ingest";

const discoveredExpressions: DiscoveredOfficialExpression[] = [
  {
    sourceExpressionId: "ogl",
    canonicalEliUri: "https://eli.gov.pl/eli/DU/1964/93/ogl",
    versionKind: "promulgated",
    evidence: "test",
  },
  {
    sourceExpressionId: "tj",
    canonicalEliUri: "https://eli.gov.pl/eli/DU/1964/93/tj",
    versionKind: "consolidated",
    evidence: "test",
  },
  {
    sourceExpressionId: "uj",
    canonicalEliUri: "https://eli.gov.pl/eli/DU/1964/93/uj",
    versionKind: "unified",
    evidence: "test",
  },
];

const testDatabase = createTestDatabase();
const describeDatabase = testDatabase ? describe : describe.skip;
const client = testDatabase?.client;
const db = testDatabase?.db;

afterAll(async () => {
  await client?.end({ timeout: 1 });
});

describeDatabase("ingestEliActMetadata idempotency", () => {
  beforeEach(async () => {
    if (!db) {
      return;
    }

    await db
      .delete(legalActs)
      .where(and(eq(legalActs.source, "sejm_eli"), eq(legalActs.sourceId, "DU/1964/93")));
  });

  it("does not create duplicate legal acts, versions, or resources", async () => {
    if (!db) {
      throw new Error("DATABASE_URL is required for integration test");
    }

    const fetchMetadata = vi.fn(async () => fixture);

    const first = await ingestEliActMetadata(
      { publisher: "DU", year: 1964, position: 93 },
      {
        fetchMetadata,
        discoverExpressions: async () => discoveredExpressions,
        now: new Date("2026-08-08T00:00:00Z"),
        db,
      },
    );

    const second = await ingestEliActMetadata(
      { publisher: "DU", year: 1964, position: 93 },
      {
        fetchMetadata,
        discoverExpressions: async () => discoveredExpressions,
        now: new Date("2026-08-08T00:00:00Z"),
        db,
      },
    );

    const actCountResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(legalActs)
      .where(and(eq(legalActs.source, "sejm_eli"), eq(legalActs.sourceId, "DU/1964/93")));

    const actRow = (
      await db
        .select({ id: legalActs.id })
        .from(legalActs)
        .where(and(eq(legalActs.source, "sejm_eli"), eq(legalActs.sourceId, "DU/1964/93")))
        .limit(1)
    )[0];
    expect(actRow).toBeDefined();
    if (!actRow) {
      throw new Error("Expected legal act row to exist after ingestion");
    }

    const versionCountResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(legalActVersions)
      .where(eq(legalActVersions.legalActId, actRow.id));

    const resolvedResourceCountResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(legalActResources)
      .where(
        and(
          eq(legalActResources.legalActId, actRow.id),
          isNotNull(legalActResources.legalActVersionId),
        ),
      );

    const unresolvedResourceCountResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(legalActResources)
      .where(
        and(
          eq(legalActResources.legalActId, actRow.id),
          isNull(legalActResources.legalActVersionId),
        ),
      );

    expect(first.actAction).toBe("inserted");
    expect(second.actAction).toBe("unchanged");
    expect(first.versions.inserted).toBe(3);
    expect(second.versions.unchanged).toBe(3);
    expect(first.resources.inserted).toBe(6);
    expect(second.resources.unchanged).toBe(6);
    expect(first.resources.resolvedCount).toBe(3);
    expect(first.resources.unresolvedCount).toBe(3);
    expect(first.sourceSelection.retrievalVersion).toBe("uj");
    expect(first.sourceSelection.authoritativeVersion).toBe("tj");
    expect(actCountResult[0].count).toBe(1);
    expect(versionCountResult[0].count).toBe(3);
    expect(resolvedResourceCountResult[0].count).toBe(3);
    expect(unresolvedResourceCountResult[0].count).toBe(3);
  });

  it("without fetchReferences (existing/legacy callers), never touches relations and behaves exactly as before", async () => {
    if (!db) throw new Error("DATABASE_URL is required for integration test");

    const result = await ingestEliActMetadata(
      { publisher: "DU", year: 1964, position: 93 },
      {
        fetchMetadata: vi.fn(async () => fixture),
        discoverExpressions: async () => discoveredExpressions,
        now: new Date("2026-08-08T00:00:00Z"),
        db,
      },
    );

    expect(result.relations).toEqual({ inserted: 0, updated: 0, deactivated: 0, resolved: 0 });
  });

  it("with fetchReferences provided, syncs the relation graph as part of the same ingest", async () => {
    if (!db) throw new Error("DATABASE_URL is required for integration test");

    const result = await ingestEliActMetadata(
      { publisher: "DU", year: 1964, position: 93 },
      {
        fetchMetadata: vi.fn(async () => fixture),
        fetchReferences: async () => ({
          "Akty zmieniające": [{ act: { publisher: "DU", year: 2020, pos: 1, title: "Amendment" } }],
        }),
        discoverExpressions: async () => discoveredExpressions,
        now: new Date("2026-08-08T00:00:00Z"),
        db,
      },
    );

    expect(result.relations).toEqual({ inserted: 1, updated: 0, deactivated: 0, resolved: 0 });

    const actRow = (
      await db
        .select({ id: legalActs.id })
        .from(legalActs)
        .where(and(eq(legalActs.source, "sejm_eli"), eq(legalActs.sourceId, "DU/1964/93")))
        .limit(1)
    )[0];
    const relations = await db.select().from(legalActRelations).where(eq(legalActRelations.legalActId, actRow.id));
    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({ relationType: "amending_act", relatedSourceId: "DU/2020/1" });
  });

  it("a discovery-based re-ingest never touches an announcement-backed 'tj' version, even though both share sourceExpressionId 'tj'", async () => {
    if (!db) throw new Error("DATABASE_URL is required for integration test");

    const first = await ingestEliActMetadata(
      { publisher: "DU", year: 1964, position: 93 },
      {
        fetchMetadata: vi.fn(async () => fixture),
        discoverExpressions: async () => discoveredExpressions,
        now: new Date("2026-08-08T00:00:00Z"),
        db,
      },
    );

    const actRow = (
      await db
        .select({ id: legalActs.id })
        .from(legalActs)
        .where(and(eq(legalActs.source, "sejm_eli"), eq(legalActs.sourceId, "DU/1964/93")))
        .limit(1)
    )[0];

    const [announcement] = await db
      .insert(legalActs)
      .values({ jurisdiction: "PL", source: "sejm_eli", sourceId: "DU/2024/1061", title: "Announcement", actType: "Obwieszczenie" })
      .returning();
    const [announcementBackedTj] = await db
      .insert(legalActVersions)
      .values({
        legalActId: actRow.id,
        versionKind: "consolidated",
        sourceExpressionId: "tj",
        sourceAnnouncementLegalActId: announcement.id,
        sourceDocumentKey: "announcement:DU/2024/1061",
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

    // Re-run the SAME reachability-based ingest that already created the legacy bare `tj` row.
    await ingestEliActMetadata(
      { publisher: "DU", year: 1964, position: 93 },
      {
        fetchMetadata: vi.fn(async () => fixture),
        discoverExpressions: async () => discoveredExpressions,
        now: new Date("2026-08-08T00:10:00Z"),
        db,
      },
    );

    const [untouchedVersion] = await db
      .select()
      .from(legalActVersions)
      .where(eq(legalActVersions.id, announcementBackedTj.id));
    expect(untouchedVersion.sourceAnnouncementLegalActId).toBe(announcement.id);
    const untouchedProvisions = await db
      .select()
      .from(legalProvisions)
      .where(eq(legalProvisions.legalActVersionId, announcementBackedTj.id));
    expect(untouchedProvisions).toHaveLength(1);
    expect(untouchedProvisions[0].text).toBe("Immutable announcement-backed text — must survive.");

    const legacyTjRows = await db
      .select()
      .from(legalActVersions)
      .where(
        and(
          eq(legalActVersions.legalActId, actRow.id),
          eq(legalActVersions.sourceExpressionId, "tj"),
          isNull(legalActVersions.sourceAnnouncementLegalActId),
        ),
      );
    expect(legacyTjRows).toHaveLength(1);
    expect(first.versions.inserted).toBe(3);

    // Base act first (cascades away the version that references the announcement — the
    // announcement's own legal_acts row is FK-protected from deletion while still cited, by
    // design), then the now-unreferenced announcement row.
    await db.delete(legalActs).where(and(eq(legalActs.source, "sejm_eli"), eq(legalActs.sourceId, "DU/1964/93")));
    await db.delete(legalActs).where(eq(legalActs.sourceId, "DU/2024/1061"));
  });
});
