import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { explorerHistoryEntries, explorerSavedItems } from "../../../db/schema";
import { buildContentKey } from "../saved/content-key";
import { createSavedItem, getSavedItem } from "../saved/service";
import type { SavedAnswerSnapshot } from "../saved/snapshot";
import { createTestDatabase } from "../../test-support/test-db";
import type { ExplorerHistorySnapshot } from "./snapshot";
import {
  cleanupHistoryForVisitor,
  clearHistory,
  createHistoryEntry,
  deleteHistoryEntry,
  getHistoryEntry,
  HistoryServiceError,
  listHistoryEntries,
  safeCleanupHistoryForVisitor,
} from "./service";

const testDatabase = createTestDatabase();
const describeDatabase = testDatabase ? describe : describe.skip;
const client = testDatabase?.client;
const db = testDatabase?.db;

const VISITOR_A = "11111111-1111-4111-8111-111111111111";
const VISITOR_B = "22222222-2222-4222-8222-222222222222";
const CORPUS_VERSION_ID = "572d313e-ae03-4207-97c6-38e2e5088617";

function snapshot(overrides: Partial<ExplorerHistorySnapshot> = {}): ExplorerHistorySnapshot {
  return {
    status: "answered",
    answer: "Odpowiedź testowa.",
    conclusions: [{ statement: "Teza.", citationLabels: ["art. 1"] }],
    alternativePaths: [],
    uncertainties: [],
    citedSources: [
      { actTitle: "Ustawa testowa", citationLabel: "art. 1", text: "Treść.", isNonAuthoritative: false, isCurrentnessUnproven: true, provenCurrentAsOf: null },
    ],
    clarificationQuestion: null,
    ...overrides,
  };
}

afterAll(async () => {
  await client?.end({ timeout: 1 });
});

describeDatabase("explorer history service", () => {
  beforeEach(async () => {
    if (!db) return;
    await db.delete(explorerHistoryEntries).where(eq(explorerHistoryEntries.visitorId, VISITOR_A));
    await db.delete(explorerHistoryEntries).where(eq(explorerHistoryEntries.visitorId, VISITOR_B));
  });

  it("creates and reads back an entry with the exact stored snapshot", async () => {
    if (!db) throw new Error("unreachable");

    const created = await createHistoryEntry({
      db,
      visitorId: VISITOR_A,
      query: "opis problemu",
      status: "answered",
      snapshot: snapshot(),
      corpusVersionIds: [CORPUS_VERSION_ID],
    });

    const fetched = await getHistoryEntry({ db, visitorId: VISITOR_A, id: created.id });
    expect(fetched).not.toBeNull();
    expect(fetched?.query).toBe("opis problemu");
    expect(fetched?.status).toBe("answered");
    expect(fetched?.snapshot).toEqual(snapshot());
    expect(fetched?.corpusVersionIds).toEqual([CORPUS_VERSION_ID]);
  });

  it("lists entries newest first", async () => {
    if (!db) throw new Error("unreachable");

    const first = await createHistoryEntry({
      db,
      visitorId: VISITOR_A,
      query: "pierwsze pytanie",
      status: "answered",
      snapshot: snapshot(),
      corpusVersionIds: [CORPUS_VERSION_ID],
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await createHistoryEntry({
      db,
      visitorId: VISITOR_A,
      query: "drugie pytanie",
      status: "insufficient_evidence",
      snapshot: snapshot({ status: "insufficient_evidence", conclusions: [], citedSources: [] }),
      corpusVersionIds: [CORPUS_VERSION_ID],
    });

    const list = await listHistoryEntries({ db, visitorId: VISITOR_A });
    expect(list.map((entry) => entry.id)).toEqual([second.id, first.id]);
  });

  it("bounds the list to the configured limit", async () => {
    if (!db) throw new Error("unreachable");

    for (let i = 0; i < 5; i += 1) {
      await createHistoryEntry({
        db,
        visitorId: VISITOR_A,
        query: `pytanie ${i}`,
        status: "answered",
        snapshot: snapshot(),
        corpusVersionIds: [CORPUS_VERSION_ID],
      });
    }

    const list = await listHistoryEntries({ db, visitorId: VISITOR_A, limit: 3 });
    expect(list).toHaveLength(3);
  });

  it("visitor A cannot list visitor B's history", async () => {
    if (!db) throw new Error("unreachable");

    await createHistoryEntry({
      db,
      visitorId: VISITOR_B,
      query: "pytanie należące do B",
      status: "answered",
      snapshot: snapshot(),
      corpusVersionIds: [CORPUS_VERSION_ID],
    });

    const listA = await listHistoryEntries({ db, visitorId: VISITOR_A });
    expect(listA).toEqual([]);
  });

  it("visitor A cannot read visitor B's entry even by knowing its UUID", async () => {
    if (!db) throw new Error("unreachable");

    const created = await createHistoryEntry({
      db,
      visitorId: VISITOR_B,
      query: "pytanie należące do B",
      status: "answered",
      snapshot: snapshot(),
      corpusVersionIds: [CORPUS_VERSION_ID],
    });

    const fetched = await getHistoryEntry({ db, visitorId: VISITOR_A, id: created.id });
    expect(fetched).toBeNull();
  });

  it("visitor A cannot delete visitor B's entry even by knowing its UUID", async () => {
    if (!db) throw new Error("unreachable");

    const created = await createHistoryEntry({
      db,
      visitorId: VISITOR_B,
      query: "pytanie należące do B",
      status: "answered",
      snapshot: snapshot(),
      corpusVersionIds: [CORPUS_VERSION_ID],
    });

    await deleteHistoryEntry({ db, visitorId: VISITOR_A, id: created.id });

    const stillThere = await getHistoryEntry({ db, visitorId: VISITOR_B, id: created.id });
    expect(stillThere).not.toBeNull();
  });

  it("deletes a single entry owned by the caller", async () => {
    if (!db) throw new Error("unreachable");

    const created = await createHistoryEntry({
      db,
      visitorId: VISITOR_A,
      query: "do usunięcia",
      status: "answered",
      snapshot: snapshot(),
      corpusVersionIds: [CORPUS_VERSION_ID],
    });

    await deleteHistoryEntry({ db, visitorId: VISITOR_A, id: created.id });

    expect(await getHistoryEntry({ db, visitorId: VISITOR_A, id: created.id })).toBeNull();
  });

  it("deleting a nonexistent id is a safe no-op", async () => {
    if (!db) throw new Error("unreachable");
    await expect(
      deleteHistoryEntry({ db, visitorId: VISITOR_A, id: "00000000-0000-4000-8000-000000000000" }),
    ).resolves.toBeUndefined();
  });

  it("clears all history for the visitor only", async () => {
    if (!db) throw new Error("unreachable");

    await createHistoryEntry({ db, visitorId: VISITOR_A, query: "a1", status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] });
    await createHistoryEntry({ db, visitorId: VISITOR_A, query: "a2", status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] });
    await createHistoryEntry({ db, visitorId: VISITOR_B, query: "b1", status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] });

    await clearHistory({ db, visitorId: VISITOR_A, scope: "all" });

    expect(await listHistoryEntries({ db, visitorId: VISITOR_A })).toEqual([]);
    expect(await listHistoryEntries({ db, visitorId: VISITOR_B })).toHaveLength(1);
  });

  it("clears only entries within the last 7 days", async () => {
    if (!db) throw new Error("unreachable");

    const recent = await createHistoryEntry({ db, visitorId: VISITOR_A, query: "recent", status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] });
    const old = await createHistoryEntry({ db, visitorId: VISITOR_A, query: "old", status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] });

    await db
      .update(explorerHistoryEntries)
      .set({ createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) })
      .where(eq(explorerHistoryEntries.id, old.id));

    await clearHistory({ db, visitorId: VISITOR_A, scope: "last_7_days" });

    expect(await getHistoryEntry({ db, visitorId: VISITOR_A, id: recent.id })).toBeNull();
    expect(await getHistoryEntry({ db, visitorId: VISITOR_A, id: old.id })).not.toBeNull();
  });

  it("clears only entries within the last 30 days", async () => {
    if (!db) throw new Error("unreachable");

    const recent = await createHistoryEntry({ db, visitorId: VISITOR_A, query: "recent", status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] });
    const veryOld = await createHistoryEntry({ db, visitorId: VISITOR_A, query: "very old", status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] });

    await db
      .update(explorerHistoryEntries)
      .set({ createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) })
      .where(eq(explorerHistoryEntries.id, veryOld.id));

    await clearHistory({ db, visitorId: VISITOR_A, scope: "last_30_days" });

    expect(await getHistoryEntry({ db, visitorId: VISITOR_A, id: recent.id })).toBeNull();
    expect(await getHistoryEntry({ db, visitorId: VISITOR_A, id: veryOld.id })).not.toBeNull();
  });

  it("clears only entries within a custom date range", async () => {
    if (!db) throw new Error("unreachable");

    const inRange = await createHistoryEntry({ db, visitorId: VISITOR_A, query: "in range", status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] });
    const outOfRange = await createHistoryEntry({ db, visitorId: VISITOR_A, query: "out of range", status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] });

    const rangeStart = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const rangeEnd = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);

    await db
      .update(explorerHistoryEntries)
      .set({ createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) })
      .where(eq(explorerHistoryEntries.id, outOfRange.id));

    await clearHistory({ db, visitorId: VISITOR_A, scope: "custom", from: rangeStart, to: rangeEnd });

    expect(await getHistoryEntry({ db, visitorId: VISITOR_A, id: inRange.id })).toBeNull();
    expect(await getHistoryEntry({ db, visitorId: VISITOR_A, id: outOfRange.id })).not.toBeNull();
  });

  it("throws when clearing with scope 'custom' but missing from/to", async () => {
    if (!db) throw new Error("unreachable");
    await expect(clearHistory({ db, visitorId: VISITOR_A, scope: "custom" })).rejects.toThrow(HistoryServiceError);
  });

  it("a malformed persisted snapshot is excluded from list results rather than crashing", async () => {
    if (!db) throw new Error("unreachable");

    const created = await createHistoryEntry({
      db,
      visitorId: VISITOR_A,
      query: "będzie zepsute",
      status: "answered",
      snapshot: snapshot(),
      corpusVersionIds: [CORPUS_VERSION_ID],
    });

    // Simulate corruption/drift that bypasses the service's own write-time validation
    // (e.g. a manual edit, a future migration, a bug) — the read path must not trust it blindly.
    await db
      .update(explorerHistoryEntries)
      .set({ resultSnapshot: { totally: "not a valid snapshot" } })
      .where(eq(explorerHistoryEntries.id, created.id));

    const list = await listHistoryEntries({ db, visitorId: VISITOR_A });
    expect(list.find((entry) => entry.id === created.id)).toBeUndefined();

    const fetched = await getHistoryEntry({ db, visitorId: VISITOR_A, id: created.id });
    expect(fetched).toBeNull();
  });

  it("rejects writing an invalid snapshot at create time", async () => {
    if (!db) throw new Error("unreachable");

    await expect(
      createHistoryEntry({
        db,
        visitorId: VISITOR_A,
        query: "opis problemu",
        status: "answered",
        // @ts-expect-error deliberately malformed for the test
        snapshot: { totally: "not a valid snapshot" },
        corpusVersionIds: [CORPUS_VERSION_ID],
      }),
    ).rejects.toThrow();
  });
});

async function createEntryWithAge(
  visitorId: string,
  query: string,
  ageDays: number,
): Promise<{ id: string }> {
  if (!db) throw new Error("unreachable");
  const created = await createHistoryEntry({ db, visitorId, query, status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] });
  await db
    .update(explorerHistoryEntries)
    .set({ createdAt: new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000) })
    .where(eq(explorerHistoryEntries.id, created.id));
  return created;
}

describeDatabase("cleanupHistoryForVisitor", () => {
  beforeEach(async () => {
    if (!db) return;
    await db.delete(explorerHistoryEntries).where(eq(explorerHistoryEntries.visitorId, VISITOR_A));
    await db.delete(explorerHistoryEntries).where(eq(explorerHistoryEntries.visitorId, VISITOR_B));
  });

  it("keeps an entry inside the retention window", async () => {
    if (!db) throw new Error("unreachable");
    const fresh = await createEntryWithAge(VISITOR_A, "fresh", 10);

    await cleanupHistoryForVisitor({ db, visitorId: VISITOR_A, retentionDays: 90, maxEntries: 300 });

    expect(await getHistoryEntry({ db, visitorId: VISITOR_A, id: fresh.id })).not.toBeNull();
  });

  it("deletes an entry older than the retention window", async () => {
    if (!db) throw new Error("unreachable");
    const stale = await createEntryWithAge(VISITOR_A, "stale", 120);

    await cleanupHistoryForVisitor({ db, visitorId: VISITOR_A, retentionDays: 90, maxEntries: 300 });

    expect(await getHistoryEntry({ db, visitorId: VISITOR_A, id: stale.id })).toBeNull();
  });

  it("boundary: an entry just inside the retention window survives (strictly-older semantics)", async () => {
    if (!db) throw new Error("unreachable");
    // created_at < now - retentionDays is the deletion rule. cleanupHistoryForVisitor
    // computes "now" itself at call time (slightly later than this test's own clock read), so
    // an entry aged to exactly retentionDays would be flaky — placed a comfortable 60s inside
    // the window instead to deterministically exercise "not yet old enough to delete" without
    // being sensitive to the few milliseconds that elapse between setup and the cleanup call.
    const created = await createHistoryEntry({ db, visitorId: VISITOR_A, query: "just inside", status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] });
    const retentionDays = 90;
    const justInsideCutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000 + 60_000);
    await db.update(explorerHistoryEntries).set({ createdAt: justInsideCutoff }).where(eq(explorerHistoryEntries.id, created.id));

    await cleanupHistoryForVisitor({ db, visitorId: VISITOR_A, retentionDays, maxEntries: 300 });

    expect(await getHistoryEntry({ db, visitorId: VISITOR_A, id: created.id })).not.toBeNull();
  });

  it("boundary: an entry one millisecond past the cutoff is deleted", async () => {
    if (!db) throw new Error("unreachable");
    const created = await createHistoryEntry({ db, visitorId: VISITOR_A, query: "just past", status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] });
    const retentionDays = 90;
    const justPastCutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000 - 1);
    await db.update(explorerHistoryEntries).set({ createdAt: justPastCutoff }).where(eq(explorerHistoryEntries.id, created.id));

    await cleanupHistoryForVisitor({ db, visitorId: VISITOR_A, retentionDays, maxEntries: 300 });

    expect(await getHistoryEntry({ db, visitorId: VISITOR_A, id: created.id })).toBeNull();
  });

  it("keeps only the newest N entries under the entry cap, deleting the oldest", async () => {
    if (!db) throw new Error("unreachable");

    const entries: { id: string }[] = [];
    for (let i = 0; i < 5; i += 1) {
      entries.push(await createHistoryEntry({ db, visitorId: VISITOR_A, query: `q${i}`, status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] }));
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    await cleanupHistoryForVisitor({ db, visitorId: VISITOR_A, retentionDays: 90, maxEntries: 3 });

    const remaining = await listHistoryEntries({ db, visitorId: VISITOR_A });
    expect(remaining).toHaveLength(3);
    // Newest 3 (indexes 2, 3, 4) survive; oldest 2 (indexes 0, 1) are gone.
    expect(remaining.map((e) => e.id).sort()).toEqual([entries[2].id, entries[3].id, entries[4].id].sort());
    expect(await getHistoryEntry({ db, visitorId: VISITOR_A, id: entries[0].id })).toBeNull();
    expect(await getHistoryEntry({ db, visitorId: VISITOR_A, id: entries[1].id })).toBeNull();
  });

  it("applies retention and the entry cap together", async () => {
    if (!db) throw new Error("unreachable");

    const stale = await createEntryWithAge(VISITOR_A, "stale", 120);
    const entries: { id: string }[] = [];
    for (let i = 0; i < 4; i += 1) {
      entries.push(await createHistoryEntry({ db, visitorId: VISITOR_A, query: `q${i}`, status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] }));
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    await cleanupHistoryForVisitor({ db, visitorId: VISITOR_A, retentionDays: 90, maxEntries: 2 });

    expect(await getHistoryEntry({ db, visitorId: VISITOR_A, id: stale.id })).toBeNull();
    const remaining = await listHistoryEntries({ db, visitorId: VISITOR_A });
    expect(remaining).toHaveLength(2);
    expect(remaining.map((e) => e.id).sort()).toEqual([entries[2].id, entries[3].id].sort());
  });

  it("cleaning up visitor A's history does not affect visitor B's history", async () => {
    if (!db) throw new Error("unreachable");

    const staleA = await createEntryWithAge(VISITOR_A, "stale a", 120);
    const staleB = await createEntryWithAge(VISITOR_B, "stale b", 120);

    await cleanupHistoryForVisitor({ db, visitorId: VISITOR_A, retentionDays: 90, maxEntries: 300 });

    expect(await getHistoryEntry({ db, visitorId: VISITOR_A, id: staleA.id })).toBeNull();
    expect(await getHistoryEntry({ db, visitorId: VISITOR_B, id: staleB.id })).not.toBeNull();
  });

  it("concurrent history writes for the same visitor cannot leave more than maxEntries rows", async () => {
    if (!db) throw new Error("unreachable");

    // Seed 3 existing entries, then fire 5 concurrent "new search" writes each immediately
    // followed by cleanup (mirroring the create-then-cleanup order used in
    // src/app/explorer/actions.ts) against a cap of 4.
    for (let i = 0; i < 3; i += 1) {
      await createHistoryEntry({ db, visitorId: VISITOR_A, query: `seed ${i}`, status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] });
    }

    const writes = Array.from({ length: 5 }, (_, i) =>
      (async () => {
        if (!db) throw new Error("unreachable");
        await createHistoryEntry({ db, visitorId: VISITOR_A, query: `concurrent ${i}`, status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] });
        await cleanupHistoryForVisitor({ db, visitorId: VISITOR_A, retentionDays: 90, maxEntries: 4 });
      })(),
    );
    await Promise.all(writes);

    const remaining = await listHistoryEntries({ db, visitorId: VISITOR_A, limit: 100 });
    expect(remaining.length).toBeLessThanOrEqual(4);
  });

  it("safeCleanupHistoryForVisitor never throws, even when the underlying cleanup fails", async () => {
    if (!db) throw new Error("unreachable");

    // An invalid UUID makes the underlying SQL error out ("invalid input syntax for type
    // uuid") — safeCleanupHistoryForVisitor must swallow this rather than propagate it, so a
    // successfully-recorded history entry (and the legal answer it's attached to) is never
    // retroactively broken by an opportunistic-cleanup failure.
    await expect(
      safeCleanupHistoryForVisitor({ db, visitorId: "not-a-valid-uuid", retentionDays: 90, maxEntries: 300 }),
    ).resolves.toBeUndefined();
  });

  it("rejects retentionDays <= 0 and executes no deletion", async () => {
    if (!db) throw new Error("unreachable");
    const survivor = await createHistoryEntry({ db, visitorId: VISITOR_A, query: "should survive", status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] });

    await expect(cleanupHistoryForVisitor({ db, visitorId: VISITOR_A, retentionDays: 0, maxEntries: 300 })).rejects.toThrow(HistoryServiceError);
    await expect(cleanupHistoryForVisitor({ db, visitorId: VISITOR_A, retentionDays: -5, maxEntries: 300 })).rejects.toThrow(HistoryServiceError);

    expect(await getHistoryEntry({ db, visitorId: VISITOR_A, id: survivor.id })).not.toBeNull();
  });

  it("rejects maxEntries <= 0 and executes no deletion", async () => {
    if (!db) throw new Error("unreachable");
    const survivor = await createHistoryEntry({ db, visitorId: VISITOR_A, query: "should survive", status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] });

    await expect(cleanupHistoryForVisitor({ db, visitorId: VISITOR_A, retentionDays: 90, maxEntries: 0 })).rejects.toThrow(HistoryServiceError);
    await expect(cleanupHistoryForVisitor({ db, visitorId: VISITOR_A, retentionDays: 90, maxEntries: -1 })).rejects.toThrow(HistoryServiceError);

    expect(await getHistoryEntry({ db, visitorId: VISITOR_A, id: survivor.id })).not.toBeNull();
  });

  it("rejects both limits being 0/0 (the exact combination that previously wiped all History) and executes no deletion", async () => {
    if (!db) throw new Error("unreachable");
    const survivor = await createHistoryEntry({ db, visitorId: VISITOR_A, query: "should survive", status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] });

    await expect(cleanupHistoryForVisitor({ db, visitorId: VISITOR_A, retentionDays: 0, maxEntries: 0 })).rejects.toThrow(HistoryServiceError);

    expect(await getHistoryEntry({ db, visitorId: VISITOR_A, id: survivor.id })).not.toBeNull();
  });

  it("rejects non-integer limits and executes no deletion", async () => {
    if (!db) throw new Error("unreachable");
    const survivor = await createHistoryEntry({ db, visitorId: VISITOR_A, query: "should survive", status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] });

    await expect(cleanupHistoryForVisitor({ db, visitorId: VISITOR_A, retentionDays: 90.5, maxEntries: 300 })).rejects.toThrow(HistoryServiceError);
    await expect(cleanupHistoryForVisitor({ db, visitorId: VISITOR_A, retentionDays: 90, maxEntries: 3.2 })).rejects.toThrow(HistoryServiceError);

    expect(await getHistoryEntry({ db, visitorId: VISITOR_A, id: survivor.id })).not.toBeNull();
  });

  it("rejects non-finite limits (NaN/Infinity) and executes no deletion", async () => {
    if (!db) throw new Error("unreachable");
    const survivor = await createHistoryEntry({ db, visitorId: VISITOR_A, query: "should survive", status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] });

    await expect(cleanupHistoryForVisitor({ db, visitorId: VISITOR_A, retentionDays: Number.NaN, maxEntries: 300 })).rejects.toThrow(HistoryServiceError);
    await expect(cleanupHistoryForVisitor({ db, visitorId: VISITOR_A, retentionDays: 90, maxEntries: Number.POSITIVE_INFINITY })).rejects.toThrow(HistoryServiceError);

    expect(await getHistoryEntry({ db, visitorId: VISITOR_A, id: survivor.id })).not.toBeNull();
  });

  it("safeCleanupHistoryForVisitor swallows the invalid-limits error and still executes no deletion", async () => {
    if (!db) throw new Error("unreachable");
    const survivor = await createHistoryEntry({ db, visitorId: VISITOR_A, query: "should survive", status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] });

    await expect(safeCleanupHistoryForVisitor({ db, visitorId: VISITOR_A, retentionDays: 0, maxEntries: 0 })).resolves.toBeUndefined();

    expect(await getHistoryEntry({ db, visitorId: VISITOR_A, id: survivor.id })).not.toBeNull();
  });

  it("manual clear behavior is unaffected by the existence of automatic cleanup", async () => {
    if (!db) throw new Error("unreachable");

    await createHistoryEntry({ db, visitorId: VISITOR_A, query: "a1", status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] });
    await createHistoryEntry({ db, visitorId: VISITOR_A, query: "a2", status: "answered", snapshot: snapshot(), corpusVersionIds: [CORPUS_VERSION_ID] });

    await clearHistory({ db, visitorId: VISITOR_A, scope: "all" });

    expect(await listHistoryEntries({ db, visitorId: VISITOR_A })).toEqual([]);
  });

  it("history-disabled mode performs no writes and needs no cleanup call (empty visitorId is a safe no-op)", async () => {
    if (!db) throw new Error("unreachable");
    await expect(cleanupHistoryForVisitor({ db, visitorId: "", retentionDays: 90, maxEntries: 300 })).resolves.toBeUndefined();
    expect(await listHistoryEntries({ db, visitorId: VISITOR_A })).toEqual([]);
  });
});

describeDatabase("Saved independence from History retention", () => {
  beforeEach(async () => {
    if (!db) return;
    await db.delete(explorerHistoryEntries).where(eq(explorerHistoryEntries.visitorId, VISITOR_A));
    await db.delete(explorerSavedItems).where(eq(explorerSavedItems.visitorId, VISITOR_A));
  });

  it("a Saved answer survives its source History entry being removed by retention", async () => {
    if (!db) throw new Error("unreachable");

    const entry = await createEntryWithAge(VISITOR_A, "sąsiad wyciął drzewo", 120);
    const entryFetchedBeforeCleanup = await getHistoryEntry({ db, visitorId: VISITOR_A, id: entry.id });
    if (!entryFetchedBeforeCleanup) throw new Error("unreachable");

    const savedSnapshot: SavedAnswerSnapshot = {
      query: entryFetchedBeforeCleanup.query,
      status: entryFetchedBeforeCleanup.snapshot.status,
      answer: entryFetchedBeforeCleanup.snapshot.answer,
      conclusions: entryFetchedBeforeCleanup.snapshot.conclusions,
      alternativePaths: entryFetchedBeforeCleanup.snapshot.alternativePaths,
      uncertainties: entryFetchedBeforeCleanup.snapshot.uncertainties,
      citedSources: entryFetchedBeforeCleanup.snapshot.citedSources,
      clarificationQuestion: entryFetchedBeforeCleanup.snapshot.clarificationQuestion,
    };

    const saved = await createSavedItem({
      db,
      visitorId: VISITOR_A,
      kind: "answer",
      title: "Sąsiad wyciął drzewo",
      query: entryFetchedBeforeCleanup.query,
      snapshot: savedSnapshot,
      contentKey: buildContentKey("answer", entry.id),
      maxItems: 100,
    });
    if (saved.status !== "created") throw new Error("unreachable");

    // Retention removes the source History entry.
    await cleanupHistoryForVisitor({ db, visitorId: VISITOR_A, retentionDays: 90, maxEntries: 300 });
    expect(await getHistoryEntry({ db, visitorId: VISITOR_A, id: entry.id })).toBeNull();

    // The Saved copy is untouched and still opens correctly, entirely independent of History.
    const stillSaved = await getSavedItem({ db, visitorId: VISITOR_A, id: saved.id });
    expect(stillSaved).not.toBeNull();
    expect(stillSaved?.snapshot).toEqual(savedSnapshot);
  });
});
