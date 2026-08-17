import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { explorerSavedFolders, explorerSavedItems, user } from "../../../db/schema";
import { createTestDatabase } from "../../test-support/test-db";
import type { SavedAnswerSnapshot, SavedProvisionSnapshot, SavedSearchSnapshot } from "./snapshot";
import {
  createSavedFolder,
  createSavedItem,
  deleteSavedFolder,
  deleteSavedItem,
  getSavedItem,
  getSavedUsage,
  listSavedFolders,
  listSavedItems,
  moveSavedItem,
  renameSavedFolder,
} from "./service";

const testDatabase = createTestDatabase();
const describeDatabase = testDatabase ? describe : describe.skip;
const client = testDatabase?.client;
const db = testDatabase?.db;

const VISITOR_A = "33333333-3333-4333-8333-333333333333";
const VISITOR_B = "44444444-4444-4444-8444-444444444444";

const ANSWER_SNAPSHOT: SavedAnswerSnapshot = {
  query: "opis problemu",
  status: "answered",
  answer: "Odpowiedź testowa.",
  conclusions: [{ statement: "Teza.", citationLabels: ["art. 1"] }],
  alternativePaths: [],
  uncertainties: [],
  citedSources: [
    { actTitle: "Ustawa testowa", citationLabel: "art. 1", text: "Treść.", isNonAuthoritative: false, isCurrentnessUnproven: true, provenCurrentAsOf: null },
  ],
  clarificationQuestion: null,
};

const SEARCH_SNAPSHOT: SavedSearchSnapshot = { query: "przedawnienie roszczeń" };

const PROVISION_SNAPSHOT: SavedProvisionSnapshot = {
  actTitle: "Ustawa testowa",
  citationLabel: "art. 471",
  text: "Treść przepisu.",
  isNonAuthoritative: false,
  isCurrentnessUnproven: true,
  provenCurrentAsOf: null,
};

afterAll(async () => {
  await client?.end({ timeout: 1 });
});

/** Real FK fixture rows for `userId` — reused as both the "visitorId" and "userId" for each fake identity. */
async function seedFixtureUsers(): Promise<void> {
  if (!db) return;
  await db
    .insert(user)
    .values([
      { id: VISITOR_A, name: "Visitor A", email: "saved-visitor-a@test.local", emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
      { id: VISITOR_B, name: "Visitor B", email: "saved-visitor-b@test.local", emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
    ])
    .onConflictDoNothing();
}

describeDatabase("explorer saved service", () => {
  beforeEach(async () => {
    if (!db) return;
    await seedFixtureUsers();
    await db.delete(explorerSavedItems).where(eq(explorerSavedItems.visitorId, VISITOR_A));
    await db.delete(explorerSavedItems).where(eq(explorerSavedItems.visitorId, VISITOR_B));
    await db.delete(explorerSavedFolders).where(eq(explorerSavedFolders.visitorId, VISITOR_A));
    await db.delete(explorerSavedFolders).where(eq(explorerSavedFolders.visitorId, VISITOR_B));
  });

  describe("folders", () => {
    it("creates a folder", async () => {
      if (!db) throw new Error("unreachable");
      const result = await createSavedFolder({ db, visitorId: VISITOR_A, userId: VISITOR_A, name: "Prawo pracy" });
      expect(result.status).toBe("created");

      const folders = await listSavedFolders({ db, userId: VISITOR_A });
      expect(folders).toHaveLength(1);
      expect(folders[0].name).toBe("Prawo pracy");
    });

    it("trims whitespace and rejects a blank name", async () => {
      if (!db) throw new Error("unreachable");
      const created = await createSavedFolder({ db, visitorId: VISITOR_A, userId: VISITOR_A, name: "  Umowy  " });
      expect(created).toMatchObject({ status: "created" });
      const [folder] = await listSavedFolders({ db, userId: VISITOR_A });
      expect(folder.name).toBe("Umowy");

      const blank = await createSavedFolder({ db, visitorId: VISITOR_A, userId: VISITOR_A, name: "   " });
      expect(blank).toMatchObject({ status: "invalid_name" });
    });

    it("rejects a case-insensitive duplicate folder name for the same visitor", async () => {
      if (!db) throw new Error("unreachable");
      await createSavedFolder({ db, visitorId: VISITOR_A, userId: VISITOR_A, name: "Prawo pracy" });
      const duplicate = await createSavedFolder({ db, visitorId: VISITOR_A, userId: VISITOR_A, name: "prawo PRACY" });
      expect(duplicate).toMatchObject({ status: "duplicate_name" });

      // the same name is fine for a different visitor
      const otherVisitor = await createSavedFolder({ db, visitorId: VISITOR_B, userId: VISITOR_B, name: "Prawo pracy" });
      expect(otherVisitor).toMatchObject({ status: "created" });
    });

    it("renames a folder", async () => {
      if (!db) throw new Error("unreachable");
      const created = await createSavedFolder({ db, visitorId: VISITOR_A, userId: VISITOR_A, name: "Stara nazwa" });
      if (created.status !== "created") throw new Error("unreachable");

      const renamed = await renameSavedFolder({ db, userId: VISITOR_A, id: created.id, name: "Nowa nazwa" });
      expect(renamed).toMatchObject({ status: "renamed" });

      const [folder] = await listSavedFolders({ db, userId: VISITOR_A });
      expect(folder.name).toBe("Nowa nazwa");
    });

    it("rejects renaming a folder to a name that duplicates another of the visitor's folders", async () => {
      if (!db) throw new Error("unreachable");
      await createSavedFolder({ db, visitorId: VISITOR_A, userId: VISITOR_A, name: "Folder A" });
      const second = await createSavedFolder({ db, visitorId: VISITOR_A, userId: VISITOR_A, name: "Folder B" });
      if (second.status !== "created") throw new Error("unreachable");

      const result = await renameSavedFolder({ db, userId: VISITOR_A, id: second.id, name: "folder a" });
      expect(result).toMatchObject({ status: "duplicate_name" });
    });

    it("deleting a folder leaves its items saved, unfiled ('Bez folderu')", async () => {
      if (!db) throw new Error("unreachable");
      const folder = await createSavedFolder({ db, visitorId: VISITOR_A, userId: VISITOR_A, name: "Do usunięcia" });
      if (folder.status !== "created") throw new Error("unreachable");

      const item = await createSavedItem({
        db,
        visitorId: VISITOR_A,
        userId: VISITOR_A,
        kind: "answer",
        title: "Tytuł",
        query: ANSWER_SNAPSHOT.query,
        folderId: folder.id,
        snapshot: ANSWER_SNAPSHOT,
        contentKey: "answer:test-1",
        maxItems: 100,
      });
      if (item.status !== "created") throw new Error("unreachable");

      await deleteSavedFolder({ db, userId: VISITOR_A, id: folder.id });

      const folders = await listSavedFolders({ db, userId: VISITOR_A });
      expect(folders).toHaveLength(0);

      const record = await getSavedItem({ db, userId: VISITOR_A, id: item.id });
      expect(record).not.toBeNull();
      expect(record?.folderId).toBeNull();
    });
  });

  describe("saving items", () => {
    it("saves an answer", async () => {
      if (!db) throw new Error("unreachable");
      const result = await createSavedItem({
        db,
        visitorId: VISITOR_A,
        userId: VISITOR_A,
        kind: "answer",
        title: "Tytuł odpowiedzi",
        query: ANSWER_SNAPSHOT.query,
        folderId: null,
        snapshot: ANSWER_SNAPSHOT,
        contentKey: "answer:test-answer",
        maxItems: 100,
      });
      expect(result.status).toBe("created");

      const items = await listSavedItems({ db, userId: VISITOR_A });
      expect(items).toHaveLength(1);
      expect(items[0].kind).toBe("answer");
      expect(items[0].snapshot).toEqual(ANSWER_SNAPSHOT);
    });

    it("saves a search", async () => {
      if (!db) throw new Error("unreachable");
      const result = await createSavedItem({
        db,
        visitorId: VISITOR_A,
        userId: VISITOR_A,
        kind: "search",
        title: SEARCH_SNAPSHOT.query,
        query: SEARCH_SNAPSHOT.query,
        folderId: null,
        snapshot: SEARCH_SNAPSHOT,
        contentKey: "search:test-search",
        maxItems: 100,
      });
      expect(result.status).toBe("created");

      const items = await listSavedItems({ db, userId: VISITOR_A });
      expect(items[0].kind).toBe("search");
      expect(items[0].snapshot).toEqual(SEARCH_SNAPSHOT);
    });

    it("saves a provision", async () => {
      if (!db) throw new Error("unreachable");
      const result = await createSavedItem({
        db,
        visitorId: VISITOR_A,
        userId: VISITOR_A,
        kind: "provision",
        title: "art. 471 — Ustawa testowa",
        query: null,
        folderId: null,
        snapshot: PROVISION_SNAPSHOT,
        contentKey: "provision:test-provision",
        maxItems: 100,
      });
      expect(result.status).toBe("created");

      const items = await listSavedItems({ db, userId: VISITOR_A });
      expect(items[0].kind).toBe("provision");
      expect(items[0].snapshot).toEqual(PROVISION_SNAPSHOT);
    });

    it("a duplicate save (same visitor+kind+contentKey) returns already_saved instead of creating a second row", async () => {
      if (!db) throw new Error("unreachable");
      const first = await createSavedItem({
        db,
        visitorId: VISITOR_A,
        userId: VISITOR_A,
        kind: "provision",
        title: "art. 471",
        query: null,
        folderId: null,
        snapshot: PROVISION_SNAPSHOT,
        contentKey: "provision:dup",
        maxItems: 100,
      });
      expect(first.status).toBe("created");

      const second = await createSavedItem({
        db,
        visitorId: VISITOR_A,
        userId: VISITOR_A,
        kind: "provision",
        title: "art. 471 (klik ponownie)",
        query: null,
        folderId: null,
        snapshot: PROVISION_SNAPSHOT,
        contentKey: "provision:dup",
        maxItems: 100,
      });
      expect(second).toMatchObject({ status: "already_saved" });
      if (first.status !== "created" || second.status !== "already_saved") throw new Error("unreachable");
      expect(second.id).toBe(first.id);

      const items = await listSavedItems({ db, userId: VISITOR_A });
      expect(items).toHaveLength(1);
    });

    it("rejects saving into a folder that does not belong to the visitor", async () => {
      if (!db) throw new Error("unreachable");
      const foreignFolder = await createSavedFolder({ db, visitorId: VISITOR_B, userId: VISITOR_B, name: "Folder B" });
      if (foreignFolder.status !== "created") throw new Error("unreachable");

      const result = await createSavedItem({
        db,
        visitorId: VISITOR_A,
        userId: VISITOR_A,
        kind: "provision",
        title: "art. 471",
        query: null,
        folderId: foreignFolder.id,
        snapshot: PROVISION_SNAPSHOT,
        contentKey: "provision:foreign-folder",
        maxItems: 100,
      });
      expect(result).toMatchObject({ status: "folder_not_found" });
    });
  });

  describe("quota", () => {
    it("blocks a new save once the quota is reached, without deleting existing items", async () => {
      if (!db) throw new Error("unreachable");

      for (let i = 0; i < 3; i += 1) {
        const result = await createSavedItem({
          db,
          visitorId: VISITOR_A,
          userId: VISITOR_A,
          kind: "provision",
          title: `Przepis ${i}`,
          query: null,
          folderId: null,
          snapshot: { ...PROVISION_SNAPSHOT, citationLabel: `art. ${i}` },
          contentKey: `provision:quota-${i}`,
          maxItems: 3,
        });
        expect(result.status).toBe("created");
      }

      const blocked = await createSavedItem({
        db,
        visitorId: VISITOR_A,
        userId: VISITOR_A,
        kind: "provision",
        title: "Przepis 4",
        query: null,
        folderId: null,
        snapshot: { ...PROVISION_SNAPSHOT, citationLabel: "art. 4" },
        contentKey: "provision:quota-4",
        maxItems: 3,
      });
      expect(blocked).toMatchObject({ status: "quota_exceeded", limit: 3 });

      const items = await listSavedItems({ db, userId: VISITOR_A });
      expect(items).toHaveLength(3);
    });

    it("folders do not count toward the item quota", async () => {
      if (!db) throw new Error("unreachable");
      for (let i = 0; i < 5; i += 1) {
        await createSavedFolder({ db, visitorId: VISITOR_A, userId: VISITOR_A, name: `Folder ${i}` });
      }

      const result = await createSavedItem({
        db,
        visitorId: VISITOR_A,
        userId: VISITOR_A,
        kind: "provision",
        title: "Przepis",
        query: null,
        folderId: null,
        snapshot: PROVISION_SNAPSHOT,
        contentKey: "provision:folders-dont-count",
        maxItems: 1,
      });
      expect(result.status).toBe("created");
    });

    it("concurrent near-simultaneous saves cannot exceed the quota", async () => {
      if (!db) throw new Error("unreachable");

      const attempts = Array.from({ length: 8 }, (_, i) =>
        createSavedItem({
          db,
          visitorId: VISITOR_A,
          userId: VISITOR_A,
          kind: "provision",
          title: `Przepis ${i}`,
          query: null,
          folderId: null,
          snapshot: { ...PROVISION_SNAPSHOT, citationLabel: `art. concurrent-${i}` },
          contentKey: `provision:concurrent-${i}`,
          maxItems: 5,
        }),
      );

      const results = await Promise.all(attempts);
      const created = results.filter((r) => r.status === "created");
      const quotaExceeded = results.filter((r) => r.status === "quota_exceeded");

      expect(created).toHaveLength(5);
      expect(quotaExceeded).toHaveLength(3);

      const items = await listSavedItems({ db, userId: VISITOR_A });
      expect(items).toHaveLength(5);
    });

    it("reports usage as count/max", async () => {
      if (!db) throw new Error("unreachable");
      await createSavedItem({
        db,
        visitorId: VISITOR_A,
        userId: VISITOR_A,
        kind: "provision",
        title: "Przepis",
        query: null,
        folderId: null,
        snapshot: PROVISION_SNAPSHOT,
        contentKey: "provision:usage",
        maxItems: 100,
      });

      const usage = await getSavedUsage({ db, userId: VISITOR_A, maxItems: 100 });
      expect(usage).toEqual({ count: 1, max: 100 });
    });
  });

  describe("move / delete", () => {
    it("moves an item between the visitor's own folders", async () => {
      if (!db) throw new Error("unreachable");
      const folderOne = await createSavedFolder({ db, visitorId: VISITOR_A, userId: VISITOR_A, name: "Folder 1" });
      const folderTwo = await createSavedFolder({ db, visitorId: VISITOR_A, userId: VISITOR_A, name: "Folder 2" });
      if (folderOne.status !== "created" || folderTwo.status !== "created") throw new Error("unreachable");

      const item = await createSavedItem({
        db,
        visitorId: VISITOR_A,
        userId: VISITOR_A,
        kind: "provision",
        title: "Przepis",
        query: null,
        folderId: folderOne.id,
        snapshot: PROVISION_SNAPSHOT,
        contentKey: "provision:move",
        maxItems: 100,
      });
      if (item.status !== "created") throw new Error("unreachable");

      const moved = await moveSavedItem({ db, userId: VISITOR_A, id: item.id, folderId: folderTwo.id });
      expect(moved).toMatchObject({ status: "moved" });

      const record = await getSavedItem({ db, userId: VISITOR_A, id: item.id });
      expect(record?.folderId).toBe(folderTwo.id);
    });

    it("moves an item out of a folder to 'Bez folderu' (folderId null)", async () => {
      if (!db) throw new Error("unreachable");
      const folder = await createSavedFolder({ db, visitorId: VISITOR_A, userId: VISITOR_A, name: "Folder" });
      if (folder.status !== "created") throw new Error("unreachable");

      const item = await createSavedItem({
        db,
        visitorId: VISITOR_A,
        userId: VISITOR_A,
        kind: "provision",
        title: "Przepis",
        query: null,
        folderId: folder.id,
        snapshot: PROVISION_SNAPSHOT,
        contentKey: "provision:unfile",
        maxItems: 100,
      });
      if (item.status !== "created") throw new Error("unreachable");

      const moved = await moveSavedItem({ db, userId: VISITOR_A, id: item.id, folderId: null });
      expect(moved).toMatchObject({ status: "moved" });

      const record = await getSavedItem({ db, userId: VISITOR_A, id: item.id });
      expect(record?.folderId).toBeNull();
    });

    it("deletes a saved item (visitor-scoped, no-op if missing)", async () => {
      if (!db) throw new Error("unreachable");
      const item = await createSavedItem({
        db,
        visitorId: VISITOR_A,
        userId: VISITOR_A,
        kind: "provision",
        title: "Przepis",
        query: null,
        folderId: null,
        snapshot: PROVISION_SNAPSHOT,
        contentKey: "provision:delete",
        maxItems: 100,
      });
      if (item.status !== "created") throw new Error("unreachable");

      await deleteSavedItem({ db, userId: VISITOR_A, id: item.id });
      expect(await getSavedItem({ db, userId: VISITOR_A, id: item.id })).toBeNull();

      // deleting again (already gone) is a safe no-op
      await expect(deleteSavedItem({ db, userId: VISITOR_A, id: item.id })).resolves.toBeUndefined();
    });
  });

  describe("cross-visitor isolation", () => {
    it("visitor A cannot list visitor B's items", async () => {
      if (!db) throw new Error("unreachable");
      await createSavedItem({
        db,
        visitorId: VISITOR_B,
        userId: VISITOR_B,
        kind: "provision",
        title: "Przepis B",
        query: null,
        folderId: null,
        snapshot: PROVISION_SNAPSHOT,
        contentKey: "provision:isolation-b",
        maxItems: 100,
      });

      const itemsForA = await listSavedItems({ db, userId: VISITOR_A });
      expect(itemsForA).toHaveLength(0);
    });

    it("visitor A cannot read visitor B's item even with its exact id", async () => {
      if (!db) throw new Error("unreachable");
      const item = await createSavedItem({
        db,
        visitorId: VISITOR_B,
        userId: VISITOR_B,
        kind: "provision",
        title: "Przepis B",
        query: null,
        folderId: null,
        snapshot: PROVISION_SNAPSHOT,
        contentKey: "provision:isolation-read",
        maxItems: 100,
      });
      if (item.status !== "created") throw new Error("unreachable");

      expect(await getSavedItem({ db, userId: VISITOR_A, id: item.id })).toBeNull();
    });

    it("visitor A cannot delete visitor B's item even with its exact id", async () => {
      if (!db) throw new Error("unreachable");
      const item = await createSavedItem({
        db,
        visitorId: VISITOR_B,
        userId: VISITOR_B,
        kind: "provision",
        title: "Przepis B",
        query: null,
        folderId: null,
        snapshot: PROVISION_SNAPSHOT,
        contentKey: "provision:isolation-delete",
        maxItems: 100,
      });
      if (item.status !== "created") throw new Error("unreachable");

      await deleteSavedItem({ db, userId: VISITOR_A, id: item.id });

      const stillThere = await getSavedItem({ db, userId: VISITOR_B, id: item.id });
      expect(stillThere).not.toBeNull();
    });

    it("visitor A cannot move visitor B's item", async () => {
      if (!db) throw new Error("unreachable");
      const item = await createSavedItem({
        db,
        visitorId: VISITOR_B,
        userId: VISITOR_B,
        kind: "provision",
        title: "Przepis B",
        query: null,
        folderId: null,
        snapshot: PROVISION_SNAPSHOT,
        contentKey: "provision:isolation-move",
        maxItems: 100,
      });
      if (item.status !== "created") throw new Error("unreachable");

      const folderA = await createSavedFolder({ db, visitorId: VISITOR_A, userId: VISITOR_A, name: "Folder A" });
      if (folderA.status !== "created") throw new Error("unreachable");

      const result = await moveSavedItem({ db, userId: VISITOR_A, id: item.id, folderId: folderA.id });
      expect(result).toMatchObject({ status: "item_not_found" });
    });

    it("visitor A cannot move their own item into visitor B's folder merely because the folder UUID is valid", async () => {
      if (!db) throw new Error("unreachable");
      const folderB = await createSavedFolder({ db, visitorId: VISITOR_B, userId: VISITOR_B, name: "Folder B" });
      if (folderB.status !== "created") throw new Error("unreachable");

      const itemA = await createSavedItem({
        db,
        visitorId: VISITOR_A,
        userId: VISITOR_A,
        kind: "provision",
        title: "Przepis A",
        query: null,
        folderId: null,
        snapshot: PROVISION_SNAPSHOT,
        contentKey: "provision:isolation-cross-folder",
        maxItems: 100,
      });
      if (itemA.status !== "created") throw new Error("unreachable");

      const result = await moveSavedItem({ db, userId: VISITOR_A, id: itemA.id, folderId: folderB.id });
      expect(result).toMatchObject({ status: "folder_not_found" });

      const record = await getSavedItem({ db, userId: VISITOR_A, id: itemA.id });
      expect(record?.folderId).toBeNull();
    });

    it("visitor A cannot rename or delete visitor B's folder", async () => {
      if (!db) throw new Error("unreachable");
      const folderB = await createSavedFolder({ db, visitorId: VISITOR_B, userId: VISITOR_B, name: "Folder B" });
      if (folderB.status !== "created") throw new Error("unreachable");

      const renameResult = await renameSavedFolder({ db, userId: VISITOR_A, id: folderB.id, name: "Zhakowane" });
      expect(renameResult).toMatchObject({ status: "not_found" });

      await deleteSavedFolder({ db, userId: VISITOR_A, id: folderB.id });
      const foldersForB = await listSavedFolders({ db, userId: VISITOR_B });
      expect(foldersForB).toHaveLength(1);
    });
  });

  describe("malformed persisted snapshot handling", () => {
    it("excludes a malformed row from listSavedItems and returns null from getSavedItem", async () => {
      if (!db) throw new Error("unreachable");
      const item = await createSavedItem({
        db,
        visitorId: VISITOR_A,
        userId: VISITOR_A,
        kind: "provision",
        title: "Przepis",
        query: null,
        folderId: null,
        snapshot: PROVISION_SNAPSHOT,
        contentKey: "provision:malformed",
        maxItems: 100,
      });
      if (item.status !== "created") throw new Error("unreachable");

      await db.update(explorerSavedItems).set({ snapshot: { totally: "not a valid snapshot" } }).where(eq(explorerSavedItems.id, item.id));

      expect(await listSavedItems({ db, userId: VISITOR_A })).toEqual([]);
      expect(await getSavedItem({ db, userId: VISITOR_A, id: item.id })).toBeNull();
    });
  });
});
