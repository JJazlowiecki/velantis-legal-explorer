import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { currentLawCorpusRuns, verifiedLegalAnswerCache } from "../../../db/schema";
import type { LegalAnswerResult, ResolvedSourceReference } from "../../legal/answer/answer";
import { createTestDatabase } from "../../test-support/test-db";
import type { ResolvedQueryCorpus } from "../run-query";
import type { ExplorerAnswerView } from "../view-model";
import { lookupVerifiedAnswer, recordVerifiedAnswer } from "./service";

const testDatabase = createTestDatabase();
const describeDatabase = testDatabase ? describe : describe.skip;
const client = testDatabase?.client;
const db = testDatabase?.db;

const TEST_PREFIX = "CACHE_TEST_HASH_";
const VERSION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const VERSION_B = "bbbbbbbb-0000-4000-8000-000000000002";
const QUESTION = "Kto może oddać krew w Polsce i jakie warunki musi spełnić dawca?";

async function insertRun(overrides: Partial<{ effectiveAsOf: string; rulesetVersion: string; selectionHash: string }> = {}) {
	if (!db) throw new Error("unreachable");
	const [row] = await db
		.insert(currentLawCorpusRuns)
		.values({
			effectiveAsOf: "2026-08-09",
			rulesetVersion: "pl-current-law-v1",
			selectionHash: `${TEST_PREFIX}${Math.random()}`,
			status: "completed",
			summary: {},
			...overrides,
		})
		.returning();
	return row;
}

function corpusFor(run: { id: string; rulesetVersion: string; effectiveAsOf: string; selectionHash: string }, legalActVersionIds: string[] = [VERSION_A]): ResolvedQueryCorpus {
	return {
		legalActVersionIds,
		corpusRunId: run.id,
		rulesetVersion: run.rulesetVersion,
		effectiveAsOf: run.effectiveAsOf,
		corpusSelectionHash: run.selectionHash,
	};
}

function sourceRef(overrides: Partial<ResolvedSourceReference> = {}): ResolvedSourceReference {
	return {
		legalProvisionId: "prov-1",
		legalActVersionId: VERSION_A,
		legalActId: "act-1",
		actTitle: "Ustawa testowa",
		citationLabel: "art. 15 pkt 2",
		versionKind: "consolidated",
		authorityClass: "authoritative",
		currentnessStatus: "unproven",
		provenCurrentAsOf: "2026-08-09",
		sourceExpressionId: "tj",
		...overrides,
	};
}

function answeredResult(overrides: Partial<LegalAnswerResult> = {}): LegalAnswerResult {
	return {
		status: "answered",
		problemDescription: QUESTION,
		legalActVersionIds: [VERSION_A],
		answer: "Na podstawie przepisów: kandydat musi mieć pełną zdolność do czynności prawnych.",
		conclusions: [{ statement: "Kandydat musi mieć pełną zdolność do czynności prawnych.", support: [sourceRef()] }],
		alternativePaths: [],
		uncertainties: [],
		clarificationQuestion: null,
		sources: [],
		...overrides,
	};
}

function viewFor(result: LegalAnswerResult): ExplorerAnswerView {
	return {
		status: result.status,
		answer: result.answer,
		conclusions: result.conclusions.map((c) => ({ statement: c.statement, citationLabels: c.support.map((s) => s.citationLabel) })),
		alternativePaths: result.alternativePaths.map((p) => ({ issueLabel: p.issueLabel, explanation: p.explanation, citationLabels: p.support.map((s) => s.citationLabel) })),
		uncertainties: result.uncertainties,
		citedSources: [...result.conclusions, ...result.alternativePaths].flatMap((item) =>
			item.support.map((s) => ({
				actTitle: s.actTitle,
				citationLabel: s.citationLabel,
				text: "Treść przepisu.",
				isNonAuthoritative: s.authorityClass === "non_authoritative",
				isCurrentnessUnproven: s.provenCurrentAsOf === null,
				provenCurrentAsOf: s.provenCurrentAsOf,
			})),
		),
		clarificationQuestion: result.clarificationQuestion,
	};
}

async function cleanup() {
	if (!db) return;
	const runs = await db
		.select({ id: currentLawCorpusRuns.id })
		.from(currentLawCorpusRuns)
		.where(like(currentLawCorpusRuns.selectionHash, `${TEST_PREFIX}%`));
	const runIds = runs.map((r) => r.id);
	if (runIds.length > 0) {
		// verifiedLegalAnswerCache.corpusRunId is onDelete:"restrict" — must be cleared before the
		// run rows themselves can be deleted.
		await db.delete(verifiedLegalAnswerCache).where(inArray(verifiedLegalAnswerCache.corpusRunId, runIds));
		await db.delete(currentLawCorpusRuns).where(inArray(currentLawCorpusRuns.id, runIds));
	}
}

afterAll(async () => {
	await cleanup();
	await client?.end({ timeout: 1 });
});

describeDatabase("verified legal answer cache", () => {
	beforeEach(cleanup);

	describe("write eligibility (recordVerifiedAnswer)", () => {
		it("caches a fully verified answered result whose sources belong to the resolved corpus", async () => {
			if (!db) throw new Error("unreachable");
			const run = await insertRun();
			const corpus = corpusFor(run);
			const result = answeredResult();

			await recordVerifiedAnswer({ db, question: QUESTION, corpus, result, view: viewFor(result) });

			const rows = await db.select().from(verifiedLegalAnswerCache).where(eq(verifiedLegalAnswerCache.corpusRunId, run.id));
			expect(rows).toHaveLength(1);
			expect(rows[0].sourceVersionIds).toEqual([VERSION_A]);
		});

		it("does NOT cache an insufficient_evidence result", async () => {
			if (!db) throw new Error("unreachable");
			const run = await insertRun();
			const corpus = corpusFor(run);
			const result = answeredResult({ status: "insufficient_evidence", conclusions: [] });

			await recordVerifiedAnswer({ db, question: QUESTION, corpus, result, view: { ...viewFor(result), status: "insufficient_evidence" } });

			const rows = await db.select().from(verifiedLegalAnswerCache).where(eq(verifiedLegalAnswerCache.corpusRunId, run.id));
			expect(rows).toHaveLength(0);
		});

		it("does NOT cache in test mode (no resolved current corpus)", async () => {
			if (!db) throw new Error("unreachable");
			const result = answeredResult();
			const testCorpus: ResolvedQueryCorpus = {
				legalActVersionIds: [VERSION_A],
				corpusRunId: null,
				rulesetVersion: null,
				effectiveAsOf: null,
				corpusSelectionHash: null,
			};

			// No run exists in this test at all, so any row landing in the table for this question's
			// hash would prove a real (invalid, FK-violating) write was attempted.
			const { hashNormalizedQuestion, normalizeQuestionForCache } = await import("./normalize");
			const questionHash = hashNormalizedQuestion(normalizeQuestionForCache(QUESTION));

			await recordVerifiedAnswer({ db, question: QUESTION, corpus: testCorpus, result, view: viewFor(result) });

			const rows = await db.select().from(verifiedLegalAnswerCache).where(eq(verifiedLegalAnswerCache.questionHash, questionHash));
			expect(rows).toHaveLength(0);
		});

		it("does NOT cache when a cited source's currentness provenance does not belong to this exact run (fail closed)", async () => {
			if (!db) throw new Error("unreachable");
			const run = await insertRun();
			const corpus = corpusFor(run);
			const result = answeredResult({
				conclusions: [{ statement: "Teza.", support: [sourceRef({ provenCurrentAsOf: null })] }],
			});

			await recordVerifiedAnswer({ db, question: QUESTION, corpus, result, view: viewFor(result) });

			const rows = await db.select().from(verifiedLegalAnswerCache).where(eq(verifiedLegalAnswerCache.corpusRunId, run.id));
			expect(rows).toHaveLength(0);
		});

		it("does NOT cache when a cited source's version is outside the resolved corpus scope", async () => {
			if (!db) throw new Error("unreachable");
			const run = await insertRun();
			const corpus = corpusFor(run, [VERSION_A]); // resolved scope does NOT include VERSION_B
			const result = answeredResult({
				conclusions: [{ statement: "Teza.", support: [sourceRef({ legalActVersionId: VERSION_B })] }],
			});

			await recordVerifiedAnswer({ db, question: QUESTION, corpus, result, view: viewFor(result) });

			const rows = await db.select().from(verifiedLegalAnswerCache).where(eq(verifiedLegalAnswerCache.corpusRunId, run.id));
			expect(rows).toHaveLength(0);
		});

		it("duplicate insertion (concurrent identical writes) never creates duplicate rows", async () => {
			if (!db) throw new Error("unreachable");
			const run = await insertRun();
			const corpus = corpusFor(run);
			const result = answeredResult();
			const view = viewFor(result);

			await Promise.all([
				recordVerifiedAnswer({ db, question: QUESTION, corpus, result, view }),
				recordVerifiedAnswer({ db, question: QUESTION, corpus, result, view }),
			]);
			await recordVerifiedAnswer({ db, question: QUESTION, corpus, result, view });

			const rows = await db.select().from(verifiedLegalAnswerCache).where(eq(verifiedLegalAnswerCache.corpusRunId, run.id));
			expect(rows).toHaveLength(1);
		});
	});

	describe("lookup validation (lookupVerifiedAnswer)", () => {
		it("first request is a MISS", async () => {
			if (!db) throw new Error("unreachable");
			const run = await insertRun();
			const corpus = corpusFor(run);

			const hit = await lookupVerifiedAnswer({ db, question: QUESTION, corpus });
			expect(hit).toBeNull();
		});

		it("second identical request is a HIT with the same safe answer, and increments hitCount/lastHitAt", async () => {
			if (!db) throw new Error("unreachable");
			const run = await insertRun();
			const corpus = corpusFor(run);
			const result = answeredResult();
			const view = viewFor(result);
			await recordVerifiedAnswer({ db, question: QUESTION, corpus, result, view });

			const before = (await db.select().from(verifiedLegalAnswerCache).where(eq(verifiedLegalAnswerCache.corpusRunId, run.id)))[0];

			const hit = await lookupVerifiedAnswer({ db, question: QUESTION, corpus });
			expect(hit).toEqual(view);

			const after = (await db.select().from(verifiedLegalAnswerCache).where(eq(verifiedLegalAnswerCache.corpusRunId, run.id)))[0];
			expect(after.hitCount).toBe(before.hitCount + 1);
			expect(after.lastHitAt.getTime()).toBeGreaterThanOrEqual(before.lastHitAt.getTime());
		});

		it("a trivial whitespace/case formatting variant of the question still hits the same entry", async () => {
			if (!db) throw new Error("unreachable");
			const run = await insertRun();
			const corpus = corpusFor(run);
			const result = answeredResult();
			const view = viewFor(result);
			await recordVerifiedAnswer({ db, question: QUESTION, corpus, result, view });

			const variant = "  KTO   MOŻE ODDAĆ KREW W POLSCE I JAKIE WARUNKI MUSI SPEŁNIĆ DAWCA?  ";
			const hit = await lookupVerifiedAnswer({ db, question: variant, corpus });
			expect(hit).toEqual(view);
		});

		it("a semantically different (negated) question does NOT hit the entry", async () => {
			if (!db) throw new Error("unreachable");
			const run = await insertRun();
			const corpus = corpusFor(run);
			const result = answeredResult();
			await recordVerifiedAnswer({ db, question: QUESTION, corpus, result, view: viewFor(result) });

			const hit = await lookupVerifiedAnswer({ db, question: "Kto nie może oddać krwi w Polsce?", corpus });
			expect(hit).toBeNull();
		});

		it("corpus isolation: the same question against a DIFFERENT corpusRunId is a MISS", async () => {
			if (!db) throw new Error("unreachable");
			const runA = await insertRun();
			const runB = await insertRun();
			const result = answeredResult();
			await recordVerifiedAnswer({ db, question: QUESTION, corpus: corpusFor(runA), result, view: viewFor(result) });

			const hit = await lookupVerifiedAnswer({ db, question: QUESTION, corpus: corpusFor(runB) });
			expect(hit).toBeNull();
		});

		it("pipeline isolation: a row persisted under a different pipelineVersion is a MISS", async () => {
			if (!db) throw new Error("unreachable");
			const run = await insertRun();
			const corpus = corpusFor(run);
			const result = answeredResult();
			const view = viewFor(result);

			// Insert directly under a stale pipelineVersion, bypassing recordVerifiedAnswer (which
			// always writes the CURRENT constant) — simulates a pre-bump cache entry.
			await db.insert(verifiedLegalAnswerCache).values({
				questionHash: (await import("./normalize")).hashNormalizedQuestion((await import("./normalize")).normalizeQuestionForCache(QUESTION)),
				corpusRunId: run.id,
				rulesetVersion: corpus.rulesetVersion!,
				effectiveAsOf: corpus.effectiveAsOf!,
				corpusSelectionHash: corpus.corpusSelectionHash!,
				pipelineVersion: "legal-answer-v0-stale",
				answerSnapshot: view,
				sourceVersionIds: [VERSION_A],
			});

			const hit = await lookupVerifiedAnswer({ db, question: QUESTION, corpus });
			expect(hit).toBeNull();
		});

		it("provenance mismatch: a row whose stored rulesetVersion/effectiveAsOf/corpusSelectionHash disagrees with the resolved corpus is a MISS, never repaired", async () => {
			if (!db) throw new Error("unreachable");
			const run = await insertRun();
			const corpus = corpusFor(run);
			const { hashNormalizedQuestion, normalizeQuestionForCache } = await import("./normalize");
			const { LEGAL_ANSWER_PIPELINE_VERSION } = await import("../../legal/answer/pipeline-version");

			// A row that (impossibly, in practice) shares this corpusRunId but has an inconsistent
			// rulesetVersion — must never be trusted on corpusRunId identity alone.
			await db.insert(verifiedLegalAnswerCache).values({
				questionHash: hashNormalizedQuestion(normalizeQuestionForCache(QUESTION)),
				corpusRunId: run.id,
				rulesetVersion: "some-other-ruleset-v9",
				effectiveAsOf: corpus.effectiveAsOf!,
				corpusSelectionHash: corpus.corpusSelectionHash!,
				pipelineVersion: LEGAL_ANSWER_PIPELINE_VERSION,
				answerSnapshot: viewFor(answeredResult()),
				sourceVersionIds: [VERSION_A],
			});

			const hit = await lookupVerifiedAnswer({ db, question: QUESTION, corpus });
			expect(hit).toBeNull();
		});

		it("source membership: a cached result referencing a version outside the freshly resolved runtime-ready corpus is rejected as a MISS", async () => {
			if (!db) throw new Error("unreachable");
			const run = await insertRun();
			const result = answeredResult();
			await recordVerifiedAnswer({ db, question: QUESTION, corpus: corpusFor(run, [VERSION_A]), result, view: viewFor(result) });

			// Re-resolve with a corpus scope that no longer includes VERSION_A (simulating it
			// dropping out of the runtime-ready set between write and lookup).
			const hit = await lookupVerifiedAnswer({ db, question: QUESTION, corpus: corpusFor(run, [VERSION_B]) });
			expect(hit).toBeNull();
		});

		it("malformed snapshot: invalid JSON/schema is a MISS, never an error", async () => {
			if (!db) throw new Error("unreachable");
			const run = await insertRun();
			const corpus = corpusFor(run);
			const { hashNormalizedQuestion, normalizeQuestionForCache } = await import("./normalize");
			const { LEGAL_ANSWER_PIPELINE_VERSION } = await import("../../legal/answer/pipeline-version");

			await db.insert(verifiedLegalAnswerCache).values({
				questionHash: hashNormalizedQuestion(normalizeQuestionForCache(QUESTION)),
				corpusRunId: run.id,
				rulesetVersion: corpus.rulesetVersion!,
				effectiveAsOf: corpus.effectiveAsOf!,
				corpusSelectionHash: corpus.corpusSelectionHash!,
				pipelineVersion: LEGAL_ANSWER_PIPELINE_VERSION,
				answerSnapshot: { garbage: true, notAValidSnapshot: 42 },
				sourceVersionIds: [VERSION_A],
			});

			await expect(lookupVerifiedAnswer({ db, question: QUESTION, corpus })).resolves.toBeNull();
		});

		it("test mode (no resolved current corpus) never looks up the cache", async () => {
			if (!db) throw new Error("unreachable");
			const testCorpus: ResolvedQueryCorpus = {
				legalActVersionIds: [VERSION_A],
				corpusRunId: null,
				rulesetVersion: null,
				effectiveAsOf: null,
				corpusSelectionHash: null,
			};
			const hit = await lookupVerifiedAnswer({ db, question: QUESTION, corpus: testCorpus });
			expect(hit).toBeNull();
		});
	});
});
