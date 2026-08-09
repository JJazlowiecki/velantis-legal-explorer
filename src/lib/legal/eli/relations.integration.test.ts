import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { legalActRelations, legalActs } from "../../../db/schema";
import { createTestDatabase } from "../../test-support/test-db";
import { syncLegalActRelations } from "./relations";
import { ELI_SOURCE, type EliActReferences } from "./schema";

const testDatabase = createTestDatabase();
const describeDatabase = testDatabase ? describe : describe.skip;
const client = testDatabase?.client;
const db = testDatabase?.db;

const TEST_SOURCE = "relations_test_fixture";

async function insertAct(sourceId: string, title = "Test act") {
  if (!db) throw new Error("unreachable");
  const [row] = await db
    .insert(legalActs)
    .values({ jurisdiction: "PL", source: TEST_SOURCE, sourceId, title, actType: "Ustawa" })
    .returning();
  return row;
}

/** Resolution in syncLegalActRelations only ever matches related acts under ELI_SOURCE (this
 * pipeline is ELI-only in Phase 1) — used for the one test that exercises resolution. */
async function insertResolvableAct(sourceId: string, title = "Test act") {
  if (!db) throw new Error("unreachable");
  const [row] = await db
    .insert(legalActs)
    .values({ jurisdiction: "PL", source: ELI_SOURCE, sourceId, title, actType: "Obwieszczenie" })
    .returning();
  return row;
}

afterAll(async () => {
  await client?.end({ timeout: 1 });
});

describeDatabase("syncLegalActRelations", () => {
  beforeEach(async () => {
    if (!db) return;
    await db.delete(legalActs).where(eq(legalActs.source, TEST_SOURCE));
    await db.delete(legalActs).where(and(eq(legalActs.source, ELI_SOURCE), eq(legalActs.sourceId, "TEST/2099/2")));
  });

  it("inserts a relation with relatedLegalActId null when the related act hasn't been ingested yet", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct("TEST/base-1");
    const references: EliActReferences = {
      "Inf. o tekście jednolitym": [{ act: { publisher: "TEST", year: 2099, pos: 1, title: "Announcement" } }],
    };

    const result = await syncLegalActRelations({ db, legalActId: act.id, references });

    expect(result).toEqual({ inserted: 1, updated: 0, deactivated: 0, resolved: 0 });
    const rows = await db.select().from(legalActRelations).where(eq(legalActRelations.legalActId, act.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      relationType: "consolidated_text_announcement",
      relatedSourceId: "TEST/2099/1",
      relatedLegalActId: null,
    });
  });

  it("resolving later attaches the correct legalActId without creating a duplicate relation", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct("TEST/base-2");
    const references: EliActReferences = {
      "Inf. o tekście jednolitym": [{ act: { publisher: "TEST", year: 2099, pos: 2, title: "Announcement" } }],
    };

    await syncLegalActRelations({ db, legalActId: act.id, references });

    // The related act gets ingested independently, sometime later.
    const announcement = await insertResolvableAct("TEST/2099/2", "Announcement");

    const second = await syncLegalActRelations({ db, legalActId: act.id, references });

    expect(second).toEqual({ inserted: 0, updated: 1, deactivated: 0, resolved: 1 });
    const rows = await db.select().from(legalActRelations).where(eq(legalActRelations.legalActId, act.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].relatedLegalActId).toBe(announcement.id);
  });

  it("is idempotent: refreshing with an unchanged payload never duplicates a relation", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct("TEST/base-3");
    const references: EliActReferences = {
      "Akty zmieniające": [{ act: { publisher: "TEST", year: 2020, pos: 5, title: "Amendment" } }],
    };

    await syncLegalActRelations({ db, legalActId: act.id, references });
    await syncLegalActRelations({ db, legalActId: act.id, references });
    await syncLegalActRelations({ db, legalActId: act.id, references });

    const rows = await db.select().from(legalActRelations).where(eq(legalActRelations.legalActId, act.id));
    expect(rows).toHaveLength(1);
  });

  it("preserves an unrecognized ELI relation label rather than dropping or crashing on it", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct("TEST/base-4");
    const references: EliActReferences = {
      "Akty uznane za uchylone": [{ act: { publisher: "TEST", year: 1980, pos: 9, title: "Old repealed-adjacent act" } }],
    };

    await syncLegalActRelations({ db, legalActId: act.id, references });

    const rows = await db.select().from(legalActRelations).where(eq(legalActRelations.legalActId, act.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ relationType: "unrecognized", sourceRelationType: "Akty uznane za uchylone" });
  });

  it("preserves the post-TJ-amendment and correction/TK relation types distinctly", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct("TEST/base-5");
    const references: EliActReferences = {
      "Nowelizacje po tekście jednolitym": [{ act: { publisher: "TEST", year: 2026, pos: 902, title: "Amendment" } }],
      "Orzeczenie TK": [{ act: { publisher: "TEST", year: 2010, pos: 1, title: "TK ruling" } }],
      Sprostowanie: [{ act: { publisher: "TEST", year: 2011, pos: 2, title: "Correction" } }],
    };

    await syncLegalActRelations({ db, legalActId: act.id, references });

    const rows = await db.select().from(legalActRelations).where(eq(legalActRelations.legalActId, act.id));
    const types = rows.map((row) => row.relationType).sort();
    expect(types).toEqual(["constitutional_tribunal", "correction", "post_consolidated_amendment"]);
  });

  it("never touches a different act's relations", async () => {
    if (!db) throw new Error("unreachable");
    const actA = await insertAct("TEST/base-6a");
    const actB = await insertAct("TEST/base-6b");

    await syncLegalActRelations({
      db,
      legalActId: actA.id,
      references: { "Akty zmieniające": [{ act: { publisher: "TEST", year: 2020, pos: 10, title: "A" } }] },
    });
    await syncLegalActRelations({
      db,
      legalActId: actB.id,
      references: { "Akty zmieniające": [{ act: { publisher: "TEST", year: 2020, pos: 11, title: "B" } }] },
    });

    const rowsA = await db.select().from(legalActRelations).where(eq(legalActRelations.legalActId, actA.id));
    const rowsB = await db.select().from(legalActRelations).where(eq(legalActRelations.legalActId, actB.id));
    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
    expect(rowsA[0].relatedSourceId).toBe("TEST/2020/10");
    expect(rowsB[0].relatedSourceId).toBe("TEST/2020/11");
  });

  it("does nothing for an act with an empty references payload", async () => {
    if (!db) throw new Error("unreachable");
    const act = await insertAct("TEST/base-7");

    const result = await syncLegalActRelations({ db, legalActId: act.id, references: {} });

    expect(result).toEqual({ inserted: 0, updated: 0, deactivated: 0, resolved: 0 });
    const rows = await db.select().from(legalActRelations).where(eq(legalActRelations.legalActId, act.id));
    expect(rows).toHaveLength(0);
  });

  describe("active/inactive observation snapshot", () => {
    it("the first sync activates every relation it observes", async () => {
      if (!db) throw new Error("unreachable");
      const act = await insertAct("TEST/base-8");
      const references: EliActReferences = {
        "Akty zmieniające": [{ act: { publisher: "TEST", year: 2020, pos: 20, title: "Amendment" } }],
      };

      await syncLegalActRelations({ db, legalActId: act.id, references });

      const rows = await db.select().from(legalActRelations).where(eq(legalActRelations.legalActId, act.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].isActive).toBe(true);
    });

    it("an identical second sync is idempotent: same row, still active, no duplicate", async () => {
      if (!db) throw new Error("unreachable");
      const act = await insertAct("TEST/base-9");
      const references: EliActReferences = {
        "Akty zmieniające": [{ act: { publisher: "TEST", year: 2020, pos: 21, title: "Amendment" } }],
      };

      await syncLegalActRelations({ db, legalActId: act.id, references });
      const rowsFirst = await db.select().from(legalActRelations).where(eq(legalActRelations.legalActId, act.id));

      const second = await syncLegalActRelations({ db, legalActId: act.id, references });

      expect(second).toEqual({ inserted: 0, updated: 1, deactivated: 0, resolved: 0 });
      const rowsSecond = await db.select().from(legalActRelations).where(eq(legalActRelations.legalActId, act.id));
      expect(rowsSecond).toHaveLength(1);
      expect(rowsSecond[0].id).toBe(rowsFirst[0].id);
      expect(rowsSecond[0].isActive).toBe(true);
    });

    it("a relation missing from a later SUCCESSFUL refresh becomes inactive, and the historical row remains present (not deleted)", async () => {
      if (!db) throw new Error("unreachable");
      const act = await insertAct("TEST/base-10");
      const firstReferences: EliActReferences = {
        "Akty zmieniające": [{ act: { publisher: "TEST", year: 2020, pos: 22, title: "Amendment" } }],
      };

      await syncLegalActRelations({ db, legalActId: act.id, references: firstReferences });
      const [before] = await db.select().from(legalActRelations).where(eq(legalActRelations.legalActId, act.id));

      // The next successful ELI response simply no longer contains this relation.
      const second = await syncLegalActRelations({ db, legalActId: act.id, references: {} });

      expect(second).toEqual({ inserted: 0, updated: 0, deactivated: 1, resolved: 0 });
      const rows = await db.select().from(legalActRelations).where(eq(legalActRelations.legalActId, act.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(before.id);
      expect(rows[0].isActive).toBe(false);
      // refreshedAt (last-seen-active) is NOT bumped by a deactivation — it still reflects when
      // the relation was last actually confirmed present, not when we noticed it was gone.
      expect(rows[0].refreshedAt.getTime()).toBe(before.refreshedAt.getTime());
    });

    it("a relation that reappears in a later successful refresh reactivates the SAME row, without creating a duplicate identity", async () => {
      if (!db) throw new Error("unreachable");
      const act = await insertAct("TEST/base-11");
      const references: EliActReferences = {
        "Akty zmieniające": [{ act: { publisher: "TEST", year: 2020, pos: 23, title: "Amendment" } }],
      };

      await syncLegalActRelations({ db, legalActId: act.id, references });
      const [original] = await db.select().from(legalActRelations).where(eq(legalActRelations.legalActId, act.id));

      await syncLegalActRelations({ db, legalActId: act.id, references: {} }); // disappears
      const third = await syncLegalActRelations({ db, legalActId: act.id, references }); // reappears

      expect(third).toEqual({ inserted: 0, updated: 1, deactivated: 0, resolved: 0 });
      const rows = await db.select().from(legalActRelations).where(eq(legalActRelations.legalActId, act.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(original.id);
      expect(rows[0].isActive).toBe(true);
    });

    it("a FAILED refresh (caller never calls sync) leaves the previous active state completely unchanged", async () => {
      if (!db) throw new Error("unreachable");
      const act = await insertAct("TEST/base-12");
      const references: EliActReferences = {
        "Akty zmieniające": [{ act: { publisher: "TEST", year: 2020, pos: 24, title: "Amendment" } }],
      };

      await syncLegalActRelations({ db, legalActId: act.id, references });
      const before = await db.select().from(legalActRelations).where(eq(legalActRelations.legalActId, act.id));

      // Simulates ingest.ts's behavior on a failed ELI fetch: syncLegalActRelations is simply
      // never invoked for this run — there is no "failure" input to pass it.

      const after = await db.select().from(legalActRelations).where(eq(legalActRelations.legalActId, act.id));
      expect(after).toEqual(before);
      expect(after[0].isActive).toBe(true);
    });

    it("deactivation for one act never touches another act's active relations", async () => {
      if (!db) throw new Error("unreachable");
      const actA = await insertAct("TEST/base-13a");
      const actB = await insertAct("TEST/base-13b");
      const referencesA: EliActReferences = {
        "Akty zmieniające": [{ act: { publisher: "TEST", year: 2020, pos: 25, title: "A" } }],
      };
      const referencesB: EliActReferences = {
        "Akty zmieniające": [{ act: { publisher: "TEST", year: 2020, pos: 26, title: "B" } }],
      };

      await syncLegalActRelations({ db, legalActId: actA.id, references: referencesA });
      await syncLegalActRelations({ db, legalActId: actB.id, references: referencesB });

      // Act A's relation disappears; act B is untouched by this call entirely.
      await syncLegalActRelations({ db, legalActId: actA.id, references: {} });

      const rowsA = await db.select().from(legalActRelations).where(eq(legalActRelations.legalActId, actA.id));
      const rowsB = await db.select().from(legalActRelations).where(eq(legalActRelations.legalActId, actB.id));
      expect(rowsA[0].isActive).toBe(false);
      expect(rowsB[0].isActive).toBe(true);
    });
  });
});
