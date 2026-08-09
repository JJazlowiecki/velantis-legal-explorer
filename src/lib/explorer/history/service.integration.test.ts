import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { explorerHistoryEntries } from "../../../db/schema";
import { createTestDatabase } from "../../test-support/test-db";
import type { ExplorerHistorySnapshot } from "./snapshot";
import {
  clearHistory,
  createHistoryEntry,
  deleteHistoryEntry,
  getHistoryEntry,
  HistoryServiceError,
  listHistoryEntries,
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
      { actTitle: "Ustawa testowa", citationLabel: "art. 1", text: "Treść.", isNonAuthoritative: false, isCurrentnessUnproven: true },
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
