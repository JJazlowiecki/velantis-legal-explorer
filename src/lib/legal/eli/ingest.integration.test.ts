import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { legalActResources, legalActs, legalActVersions, legalProvisions } from "../../../db/schema";
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

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDatabase = hasDatabase ? describe : describe.skip;

const client = process.env.DATABASE_URL
  ? postgres(process.env.DATABASE_URL, { max: 1 })
  : undefined;
const db = client
  ? drizzle({ client, schema: { legalActs, legalActVersions, legalActResources, legalProvisions } })
  : undefined;

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
});
