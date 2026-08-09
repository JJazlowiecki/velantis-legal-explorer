import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { currentLawCorpusEntries, currentLawCorpusRuns, legalActs } from "../../db/schema";
import { ELI_SOURCE } from "../legal/eli/schema";
import { generateCurrentLawCorpus } from "../legal/current-law/service";
import { createTestDatabase } from "../test-support/test-db";
import { resolveCurrentCorpus } from "./corpus-config";

const testDatabase = createTestDatabase();
const describeDatabase = testDatabase ? describe : describe.skip;
const client = testDatabase?.client;
const db = testDatabase?.db;

const TEST_PREFIX = "CCFG_TEST/";
const NOW = new Date("2026-08-09T00:00:00Z");
const EFFECTIVE_AS_OF = "2026-08-09";
const DIMENSIONS = 1536;

async function insertAct(sourceId: string, overrides: Partial<{ promulgationDate: string | null }> = {}) {
	if (!db) throw new Error("unreachable");
	const [row] = await db
		.insert((await import("../../db/schema")).legalActs)
		.values({ jurisdiction: "PL", source: ELI_SOURCE, sourceId, title: `Test act ${sourceId}`, actType: "Ustawa", inForce: true, ...overrides })
		.returning();
	return row;
}

async function insertQualifyingAct(sourceId: string) {
	const schema = await import("../../db/schema");
	if (!db) throw new Error("unreachable");
	const base = await insertAct(sourceId);
	const announcement = await insertAct(`${sourceId}-announcement`, { promulgationDate: "2024-01-01" });
	const [version] = await db
		.insert(schema.legalActVersions)
		.values({
			legalActId: base.id,
			versionKind: "consolidated",
			sourceExpressionId: "tj",
			authorityClass: "authoritative",
			sourceAnnouncementLegalActId: announcement.id,
			sourceDocumentKey: `test:${base.id}`,
		})
		.returning();
	await db.insert(schema.legalActRelations).values({
		legalActId: base.id,
		relationType: "consolidated_text_announcement",
		sourceRelationType: "Inf. o tekście jednolitym",
		relatedSourceId: announcement.sourceId,
		relatedLegalActId: announcement.id,
		isActive: true,
	});
	const [provision] = await db
		.insert(schema.legalProvisions)
		.values({
			legalActVersionId: version.id,
			provisionType: "article",
			citationLabel: "art. 1",
			text: "Treść art. 1.",
			structuralPath: "art_1",
			ordinal: 1,
		})
		.returning();
	await db.insert(schema.legalSearchDocuments).values({
		legalProvisionId: provision.id,
		legalActVersionId: version.id,
		content: "art. 1 treść",
		contentHash: `hash-${provision.id}`,
		embedding: new Array<number>(DIMENSIONS).fill(0),
		embeddingModel: "test-model",
		embeddedAt: NOW,
	});
	return base;
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

describeDatabase("resolveCurrentCorpus", () => {
	beforeEach(cleanup);

	it("returns null for a nonexistent runId", async () => {
		if (!db) throw new Error("unreachable");
		const result = await resolveCurrentCorpus({ db, runId: "00000000-0000-0000-0000-000000000000" });
		expect(result).toBeNull();
	});

	it("returns null for a run with zero included+runtimeReady entries", async () => {
		if (!db) throw new Error("unreachable");
		const run = await generateCurrentLawCorpus({ db, effectiveAsOf: EFFECTIVE_AS_OF, scope: [], now: NOW });
		const result = await resolveCurrentCorpus({ db, runId: run.runId });
		expect(result).toBeNull();
	});

	it("resolves exactly the pinned run's included+runtimeReady version ids", async () => {
		if (!db) throw new Error("unreachable");
		const act = await insertQualifyingAct(`${TEST_PREFIX}pin-a`);
		const run = await generateCurrentLawCorpus({
			db,
			effectiveAsOf: EFFECTIVE_AS_OF,
			scope: [{ sourceId: act.sourceId, label: "a" }],
			now: NOW,
		});

		const result = await resolveCurrentCorpus({ db, runId: run.runId });
		expect(result).not.toBeNull();
		expect(result?.legalActVersionIds).toEqual(run.included.map((i) => i.legalActVersionId));
		expect(result?.corpusRunId).toBe(run.runId);
		expect(result?.rulesetVersion).toBe(run.rulesetVersion);
		expect(result?.effectiveAsOf).toBe(EFFECTIVE_AS_OF);
	});

	it("never substitutes a newer usable run when an OLDER run id is explicitly pinned", async () => {
		if (!db) throw new Error("unreachable");
		const actOld = await insertQualifyingAct(`${TEST_PREFIX}pin-old`);
		const olderRun = await generateCurrentLawCorpus({
			db,
			effectiveAsOf: EFFECTIVE_AS_OF,
			scope: [{ sourceId: actOld.sourceId, label: "old" }],
			now: NOW,
		});

		const actNew = await insertQualifyingAct(`${TEST_PREFIX}pin-new`);
		const newerRun = await generateCurrentLawCorpus({
			db,
			effectiveAsOf: EFFECTIVE_AS_OF,
			scope: [{ sourceId: actNew.sourceId, label: "new" }],
			now: new Date(NOW.getTime() + 1000),
		});

		const resolvedOld = await resolveCurrentCorpus({ db, runId: olderRun.runId });
		expect(resolvedOld?.legalActVersionIds).toEqual(olderRun.included.map((i) => i.legalActVersionId));
		expect(resolvedOld?.legalActVersionIds).not.toEqual(newerRun.included.map((i) => i.legalActVersionId));
	});
});
