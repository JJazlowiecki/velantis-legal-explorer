import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { legalActResources, legalActs, legalActVersions, legalProvisions } from "../../../db/schema";
import articleStructFixture from "./__fixtures__/struct-article-based.json";
import fixture from "./__fixtures__/du-1964-93.json";
import {
  ingestEliProvisions,
  parseIngestProvisionsCliArgs,
  ProvisionIngestError,
} from "./ingest-provisions";

const articleHtmlFixture = readFileSync(
  fileURLToPath(new URL("./__fixtures__/text-article-based.html", import.meta.url)),
  "utf8",
);

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDatabase = hasDatabase ? describe : describe.skip;

const client = process.env.DATABASE_URL
  ? postgres(process.env.DATABASE_URL, { max: 1 })
  : undefined;

const db = client ? drizzle({ client, schema: { legalActs, legalActVersions, legalProvisions } }) : undefined;
const dbWithAllTables = client
  ? drizzle({
      client,
      schema: { legalActs, legalActVersions, legalActResources, legalProvisions },
    })
  : undefined;

afterAll(async () => {
  await client?.end({ timeout: 1 });
});

describe("ingestEliProvisions argument guards", () => {
  it("requires explicit target legal act version", () => {
    expect(() =>
      parseIngestProvisionsCliArgs([
        "--publisher",
        "DU",
        "--year",
        "2026",
        "--position",
        "795",
      ]),
    ).toThrow(ProvisionIngestError);
  });
});

describeDatabase("ingestEliProvisions idempotency", () => {
  beforeEach(async () => {
    if (!db) {
      return;
    }

    await db
      .delete(legalActs)
      .where(and(eq(legalActs.source, "sejm_eli"), eq(legalActs.sourceId, "DU/1964/93")));
  });

  it("persists hierarchy idempotently without duplicates", async () => {
    if (!dbWithAllTables) {
      throw new Error("DATABASE_URL is required for integration test");
    }

    const metadataFixture = {
      ...fixture,
      textHTML: true,
    };

    const first = await ingestEliProvisions(
      {
        publisher: "DU",
        year: 1964,
        position: 93,
        sourceExpressionId: "test_struct_source",
        versionKind: "consolidated",
        dryRun: false,
      },
      {
        db: dbWithAllTables,
        fetchMetadata: async () => metadataFixture,
        fetchStruct: async () => articleStructFixture,
        fetchTextHtml: async () => articleHtmlFixture,
        fetchTextHtmlFragment: async () => "",
      },
    );

    const second = await ingestEliProvisions(
      {
        publisher: "DU",
        year: 1964,
        position: 93,
        sourceExpressionId: "test_struct_source",
        versionKind: "consolidated",
        dryRun: false,
      },
      {
        db: dbWithAllTables,
        fetchMetadata: async () => metadataFixture,
        fetchStruct: async () => articleStructFixture,
        fetchTextHtml: async () => articleHtmlFixture,
        fetchTextHtmlFragment: async () => "",
      },
    );

    const act = (
      await dbWithAllTables
        .select({ id: legalActs.id })
        .from(legalActs)
        .where(and(eq(legalActs.source, "sejm_eli"), eq(legalActs.sourceId, "DU/1964/93")))
        .limit(1)
    )[0];

    expect(act).toBeDefined();
    if (!act) {
      throw new Error("Expected legal act row to exist");
    }

    const version = (
      await dbWithAllTables
        .select({ id: legalActVersions.id, isCurrent: legalActVersions.isCurrent, kind: legalActVersions.versionKind })
        .from(legalActVersions)
        .where(
          and(
            eq(legalActVersions.legalActId, act.id),
            eq(legalActVersions.sourceExpressionId, "test_struct_source"),
          ),
        )
        .limit(1)
    )[0];

    expect(version).toBeDefined();
    expect(version?.isCurrent).toBe(false);

    const provisionCount = await dbWithAllTables
      .select({ count: sql<number>`count(*)::int` })
      .from(legalProvisions)
      .where(eq(legalProvisions.legalActVersionId, version!.id));

    expect(first.provisions.inserted).toBeGreaterThan(0);
    expect(second.provisions.inserted).toBe(0);
    expect(second.provisions.updated).toBe(0);
    expect(second.provisions.unchanged).toBe(first.provisions.total);
    expect(provisionCount[0].count).toBe(first.provisions.total);

    const attachmentRows = await dbWithAllTables
      .select({ count: sql<number>`count(*)::int` })
      .from(legalProvisions)
      .where(
        and(
          eq(legalProvisions.legalActVersionId, version!.id),
          eq(legalProvisions.provisionType, "appendix"),
        ),
      );

    expect(attachmentRows[0].count).toBeGreaterThan(0);
  });
});
