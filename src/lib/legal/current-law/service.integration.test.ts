import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
	currentLawCorpusEntries,
	currentLawCorpusRuns,
	legalActRelations,
	legalActVersions,
	legalActs,
	legalProvisions,
	legalSearchDocuments,
} from "../../../db/schema";
import { ELI_SOURCE } from "../eli/schema";
import { createTestDatabase } from "../../test-support/test-db";
import { generateCurrentLawCorpus, getCurrentLawCorpusRun, getLatestUsableCurrentLawCorpus } from "./service";

const testDatabase = createTestDatabase();
const describeDatabase = testDatabase ? describe : describe.skip;
const client = testDatabase?.client;
const db = testDatabase?.db;

const TEST_PREFIX = "CLC_TEST/";
const NOW = new Date("2026-08-09T00:00:00Z");
const EFFECTIVE_AS_OF = "2026-08-09";
const DIMENSIONS = 1536;

function fakeEmbedding(seed: number): number[] {
	const vector = new Array<number>(DIMENSIONS).fill(0);
	vector[0] = seed;
	return vector;
}

async function insertAct(
	sourceId: string,
	overrides: Partial<{ inForce: boolean | null; expirationDate: string | null; promulgationDate: string | null; entryIntoForceDate: string | null }> = {},
) {
	if (!db) throw new Error("unreachable");
	const [row] = await db
		.insert(legalActs)
		.values({
			jurisdiction: "PL",
			source: ELI_SOURCE,
			sourceId,
			title: `Test act ${sourceId}`,
			actType: "Ustawa",
			inForce: true,
			...overrides,
		})
		.returning();
	return row;
}

async function insertVersion(
	legalActId: string,
	overrides: Partial<{
		sourceAnnouncementLegalActId: string | null;
		versionKind: string;
		sourceExpressionId: string;
		authorityClass: string;
	}> = {},
) {
	if (!db) throw new Error("unreachable");
	const [row] = await db
		.insert(legalActVersions)
		.values({
			legalActId,
			versionKind: "consolidated",
			sourceExpressionId: "tj",
			authorityClass: "authoritative",
			sourceDocumentKey: `test:${legalActId}:${Math.random()}`,
			...overrides,
		})
		.returning();
	return row;
}

async function insertRelation(
	legalActId: string,
	relationType: string,
	relatedSourceId: string,
	relatedLegalActId: string | null,
) {
	if (!db) throw new Error("unreachable");
	await db.insert(legalActRelations).values({
		legalActId,
		relationType,
		sourceRelationType: relationType,
		relatedSourceId,
		relatedLegalActId,
		isActive: true,
	});
}

async function insertSearchableProvision(legalActVersionId: string, citationLabel: string, embed: boolean) {
	if (!db) throw new Error("unreachable");
	const [provision] = await db
		.insert(legalProvisions)
		.values({
			legalActVersionId,
			provisionType: "article",
			citationLabel,
			text: `Treść ${citationLabel}.`,
			structuralPath: citationLabel,
			ordinal: Math.floor(Math.random() * 100000),
		})
		.returning();

	if (embed) {
		await db.insert(legalSearchDocuments).values({
			legalProvisionId: provision.id,
			legalActVersionId,
			content: `${citationLabel} treść`,
			contentHash: `hash-${provision.id}`,
			embedding: fakeEmbedding(1),
			embeddingModel: "test-model",
			embeddedAt: NOW,
		});
	}
	return provision;
}

async function cleanup() {
	if (!db) return;
	const acts = await db
		.select({ id: legalActs.id })
		.from(legalActs)
		.where(and(eq(legalActs.source, ELI_SOURCE), like(legalActs.sourceId, `${TEST_PREFIX}%`)));
	const actIds = acts.map((a) => a.id);
	if (actIds.length > 0) {
		const runs = await db
			.select({ id: currentLawCorpusEntries.runId })
			.from(currentLawCorpusEntries)
			.where(inArray(currentLawCorpusEntries.legalActId, actIds));
		const runIds = [...new Set(runs.map((r) => r.id))];
		if (runIds.length > 0) {
			await db.delete(currentLawCorpusRuns).where(inArray(currentLawCorpusRuns.id, runIds));
		}
	}
	await db.delete(legalActs).where(and(eq(legalActs.source, ELI_SOURCE), like(legalActs.sourceId, `${TEST_PREFIX}%`)));
}

afterAll(async () => {
	await cleanup();
	await client?.end({ timeout: 1 });
});

describeDatabase("generateCurrentLawCorpus", () => {
	beforeEach(cleanup);

	it("persists a run with a genuinely qualifying, runtime-ready included act and an excluded act", async () => {
		if (!db) throw new Error("unreachable");
		const base = await insertAct(`${TEST_PREFIX}qualifying`);
		const announcement = await insertAct(`${TEST_PREFIX}qualifying-announcement`, { promulgationDate: "2024-01-01" });
		const version = await insertVersion(base.id, { sourceAnnouncementLegalActId: announcement.id });
		await insertRelation(base.id, "consolidated_text_announcement", announcement.sourceId, announcement.id);
		await insertSearchableProvision(version.id, "art. 1", true);

		const excludedBase = await insertAct(`${TEST_PREFIX}excluded`, { inForce: false });

		const result = await generateCurrentLawCorpus({
			db,
			effectiveAsOf: EFFECTIVE_AS_OF,
			scope: [
				{ sourceId: base.sourceId, label: "qualifying" },
				{ sourceId: excludedBase.sourceId, label: "excluded" },
			],
			now: NOW,
		});

		expect(result.status).toBe("completed");
		expect(result.included).toEqual([{ legalActId: base.id, legalActVersionId: version.id, runtimeReady: true }]);
		expect(result.excludedByReason.act_not_in_force).toBe(1);

		const persisted = await getCurrentLawCorpusRun({ db, runId: result.runId });
		expect(persisted).not.toBeNull();
		expect(persisted?.entries).toHaveLength(2);
		const includedEntry = persisted?.entries.find((e) => e.legalActId === base.id);
		expect(includedEntry).toMatchObject({ decision: "included", reasonCode: "authoritative_current", runtimeReady: true });
	});

	it("is deterministic: identical input produces the same selectionHash across two separate runs", async () => {
		if (!db) throw new Error("unreachable");
		const base = await insertAct(`${TEST_PREFIX}deterministic`);
		const announcement = await insertAct(`${TEST_PREFIX}deterministic-announcement`, { promulgationDate: "2024-01-01" });
		const version = await insertVersion(base.id, { sourceAnnouncementLegalActId: announcement.id });
		await insertRelation(base.id, "consolidated_text_announcement", announcement.sourceId, announcement.id);
		await insertSearchableProvision(version.id, "art. 1", true);

		const scope = [{ sourceId: base.sourceId, label: "deterministic" }];
		const first = await generateCurrentLawCorpus({ db, effectiveAsOf: EFFECTIVE_AS_OF, scope, now: NOW });
		const second = await generateCurrentLawCorpus({ db, effectiveAsOf: EFFECTIVE_AS_OF, scope, now: NOW });

		expect(second.selectionHash).toBe(first.selectionHash);
		expect(second.runId).not.toBe(first.runId);
	});

	it("never mutates a prior run when a new run is generated", async () => {
		if (!db) throw new Error("unreachable");
		const base = await insertAct(`${TEST_PREFIX}immutable`);
		const announcement = await insertAct(`${TEST_PREFIX}immutable-announcement`, { promulgationDate: "2024-01-01" });
		const version = await insertVersion(base.id, { sourceAnnouncementLegalActId: announcement.id });
		await insertRelation(base.id, "consolidated_text_announcement", announcement.sourceId, announcement.id);
		await insertSearchableProvision(version.id, "art. 1", true);

		const scope = [{ sourceId: base.sourceId, label: "immutable" }];
		const first = await generateCurrentLawCorpus({ db, effectiveAsOf: EFFECTIVE_AS_OF, scope, now: NOW });
		const before = await getCurrentLawCorpusRun({ db, runId: first.runId });

		await generateCurrentLawCorpus({ db, effectiveAsOf: EFFECTIVE_AS_OF, scope, now: NOW });
		const after = await getCurrentLawCorpusRun({ db, runId: first.runId });

		expect(after).toEqual(before);
	});

	it("marks an included act NOT runtimeReady when its provisions are not indexed/embedded", async () => {
		if (!db) throw new Error("unreachable");
		const base = await insertAct(`${TEST_PREFIX}notready`);
		const announcement = await insertAct(`${TEST_PREFIX}notready-announcement`, { promulgationDate: "2024-01-01" });
		const version = await insertVersion(base.id, { sourceAnnouncementLegalActId: announcement.id });
		await insertRelation(base.id, "consolidated_text_announcement", announcement.sourceId, announcement.id);
		await insertSearchableProvision(version.id, "art. 1", false);

		const result = await generateCurrentLawCorpus({
			db,
			effectiveAsOf: EFFECTIVE_AS_OF,
			scope: [{ sourceId: base.sourceId, label: "notready" }],
			now: NOW,
		});

		expect(result.included).toEqual([{ legalActId: base.id, legalActVersionId: version.id, runtimeReady: false }]);
	});

	it("proves runtimeReady is not broken by non-searchable container provisions never being indexed", async () => {
		if (!db) throw new Error("unreachable");
		const base = await insertAct(`${TEST_PREFIX}containers`);
		const announcement = await insertAct(`${TEST_PREFIX}containers-announcement`, { promulgationDate: "2024-01-01" });
		const version = await insertVersion(base.id, { sourceAnnouncementLegalActId: announcement.id });
		await insertRelation(base.id, "consolidated_text_announcement", announcement.sourceId, announcement.id);

		// A container provision (chapter) never gets a search document — this must not prevent
		// runtimeReady from becoming true once the one real operative provision IS embedded.
		if (!db) throw new Error("unreachable");
		await db.insert(legalProvisions).values({
			legalActVersionId: version.id,
			provisionType: "chapter",
			citationLabel: "Rozdział 1",
			heading: "Rozdział 1",
			text: "Rozdział 1",
			structuralPath: "chapter_1",
			ordinal: 1,
		});
		await insertSearchableProvision(version.id, "art. 1", true);

		const result = await generateCurrentLawCorpus({
			db,
			effectiveAsOf: EFFECTIVE_AS_OF,
			scope: [{ sourceId: base.sourceId, label: "containers" }],
			now: NOW,
		});

		expect(result.included[0]?.runtimeReady).toBe(true);
	});

	it("records a scope entry with no ingested legalActs row only in unresolvedScope, not as an entry", async () => {
		if (!db) throw new Error("unreachable");
		const result = await generateCurrentLawCorpus({
			db,
			effectiveAsOf: EFFECTIVE_AS_OF,
			scope: [{ sourceId: `${TEST_PREFIX}never-ingested`, label: "missing" }],
			now: NOW,
		});

		expect(result.unresolvedScope).toEqual([`${TEST_PREFIX}never-ingested`]);
		expect(result.entries).toHaveLength(0);
	});

	it("rejects an effectiveAsOf other than the injected current date for pl-current-law-v1", async () => {
		if (!db) throw new Error("unreachable");
		await expect(
			generateCurrentLawCorpus({ db, effectiveAsOf: "2020-01-01", scope: [], now: NOW }),
		).rejects.toThrow(/only supports generating a corpus for the current date/);
	});

	it("G/H: a completed run keeps resolving its OLD content revision; a NEW run generated after a corrected re-parse (new version row, same announcement) selects the NEW revision, and the old run/entries are never mutated", async () => {
		if (!db) throw new Error("unreachable");
		const base = await insertAct(`${TEST_PREFIX}revision`);
		const announcement = await insertAct(`${TEST_PREFIX}revision-announcement`, { promulgationDate: "2024-01-01" });
		await insertRelation(base.id, "consolidated_text_announcement", announcement.sourceId, announcement.id);

		// The "old, buggy parser" revision — this is what a completed run was generated against.
		const oldRevision = await insertVersion(base.id, {
			sourceAnnouncementLegalActId: announcement.id,
		});
		await insertSearchableProvision(oldRevision.id, "art. 1", true);

		const scope = [{ sourceId: base.sourceId, label: "revision" }];
		const oldRun = await generateCurrentLawCorpus({ db, effectiveAsOf: EFFECTIVE_AS_OF, scope, now: NOW });
		expect(oldRun.included).toEqual([{ legalActId: base.id, legalActVersionId: oldRevision.id, runtimeReady: true }]);
		const oldRunSnapshot = await getCurrentLawCorpusRun({ db, runId: oldRun.runId });

		// Simulate the parser fix producing a NEW, separate immutable revision for the SAME
		// announcement (as consolidated-ingest.ts now does) — never touching oldRevision's row.
		const newRevision = await insertVersion(base.id, {
			sourceAnnouncementLegalActId: announcement.id,
		});
		await insertSearchableProvision(newRevision.id, "art. 1", true);
		await insertSearchableProvision(newRevision.id, "art. 1 ust. 1", true); // the recovered ustęp

		const newRun = await generateCurrentLawCorpus({ db, effectiveAsOf: EFFECTIVE_AS_OF, scope, now: NOW });
		expect(newRun.included).toEqual([{ legalActId: base.id, legalActVersionId: newRevision.id, runtimeReady: true }]);
		expect(newRun.runId).not.toBe(oldRun.runId);
		expect(newRun.selectionHash).not.toBe(oldRun.selectionHash); // differs: legalActVersionId is part of the hashed entry

		// The OLD run is byte-for-byte unchanged after the new run was generated.
		const oldRunSnapshotAfter = await getCurrentLawCorpusRun({ db, runId: oldRun.runId });
		expect(oldRunSnapshotAfter).toEqual(oldRunSnapshot);
		expect(oldRunSnapshotAfter?.entries.find((e) => e.legalActId === base.id)?.legalActVersionId).toBe(oldRevision.id);

		// The OLD revision's own provisions are also untouched (still exactly 1, not 2).
		const oldProvisions = await db.select().from(legalProvisions).where(eq(legalProvisions.legalActVersionId, oldRevision.id));
		expect(oldProvisions).toHaveLength(1);
	});
});

describeDatabase("getLatestUsableCurrentLawCorpus (admin helper)", () => {
	beforeEach(cleanup);

	it("never returns a run with zero runtimeReady included entries even if it is the newest", async () => {
		if (!db) throw new Error("unreachable");
		const base = await insertAct(`${TEST_PREFIX}latest-usable`);
		const announcement = await insertAct(`${TEST_PREFIX}latest-usable-announcement`, { promulgationDate: "2024-01-01" });
		const version = await insertVersion(base.id, { sourceAnnouncementLegalActId: announcement.id });
		await insertRelation(base.id, "consolidated_text_announcement", announcement.sourceId, announcement.id);
		await insertSearchableProvision(version.id, "art. 1", true);

		const usable = await generateCurrentLawCorpus({
			db,
			effectiveAsOf: EFFECTIVE_AS_OF,
			scope: [{ sourceId: base.sourceId, label: "usable" }],
			now: NOW,
		});

		// A second, newer run with nothing usable (empty scope) must not be returned as "latest".
		await generateCurrentLawCorpus({ db, effectiveAsOf: EFFECTIVE_AS_OF, scope: [], now: new Date(NOW.getTime() + 1000) });

		const latest = await getLatestUsableCurrentLawCorpus({ db });
		expect(latest?.runId).toBe(usable.runId);
	});
});
