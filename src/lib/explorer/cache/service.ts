import { createHash } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema";
import { verifiedLegalAnswerCache } from "../../../db/schema";
import type { LegalAnswerResult } from "../../legal/answer/answer";
import { LEGAL_ANSWER_PIPELINE_VERSION } from "../../legal/answer/pipeline-version";
import { explorerHistoryCorpusVersionIdsSchema, explorerHistorySnapshotSchema } from "../history/snapshot";
import type { ResolvedQueryCorpus } from "../run-query";
import type { ExplorerAnswerView } from "../view-model";
import { hashNormalizedQuestion, normalizeQuestionForCache } from "./normalize";

type Db = PostgresJsDatabase<typeof schema>;

/** True only when every provenance field needed for a valid cache identity is present — i.e. CURRENT corpus mode with a real resolved run. Test mode (all fields null) is always false here. */
function hasCurrentCorpusIdentity(
	corpus: ResolvedQueryCorpus,
): corpus is ResolvedQueryCorpus & {
	corpusRunId: string;
	rulesetVersion: string;
	effectiveAsOf: string;
	corpusSelectionHash: string;
} {
	return Boolean(corpus.corpusRunId && corpus.rulesetVersion && corpus.effectiveAsOf && corpus.corpusSelectionHash);
}

export interface LookupVerifiedAnswerInput {
	db: Db;
	question: string;
	corpus: ResolvedQueryCorpus;
}

/**
 * Exact-match, CURRENT-corpus-only verified answer cache lookup. Returns null (a plain cache
 * MISS — never a thrown error surfaced to the caller) whenever ANY validation fails: a
 * database row existing is never sufficient on its own. Validates, in order: current-mode
 * identity present, exact `(questionHash, corpusRunId, pipelineVersion)` match,
 * rulesetVersion/effectiveAsOf/corpusSelectionHash re-confirmation, snapshot schema validity,
 * `status === "answered"`, and that every cited source's legalActVersionId is still a member
 * of the FRESHLY resolved runtime-ready corpus set. See recordVerifiedAnswer for the matching
 * write-eligibility rules. Never mutates `legal_act_versions.currentnessStatus` — currentness
 * provenance is entirely inherited from the exact-matched corpus run, never recomputed here.
 */
export async function lookupVerifiedAnswer(input: LookupVerifiedAnswerInput): Promise<ExplorerAnswerView | null> {
	if (!hasCurrentCorpusIdentity(input.corpus)) {
		return null;
	}
	const corpus = input.corpus;

	try {
		const questionHash = hashNormalizedQuestion(normalizeQuestionForCache(input.question));

		const [row] = await input.db
			.select()
			.from(verifiedLegalAnswerCache)
			.where(
				and(
					eq(verifiedLegalAnswerCache.questionHash, questionHash),
					eq(verifiedLegalAnswerCache.corpusRunId, corpus.corpusRunId),
					eq(verifiedLegalAnswerCache.pipelineVersion, LEGAL_ANSWER_PIPELINE_VERSION),
				),
			)
			.limit(1);

		if (!row) {
			return null;
		}

		// Defense in depth: a run's own fields never change after creation, so if corpusRunId
		// already matched these should always match too — but a cache row's provenance is never
		// trusted on identity alone. Never "repair" a mismatch; treat it as a miss.
		if (
			row.rulesetVersion !== corpus.rulesetVersion ||
			row.effectiveAsOf !== corpus.effectiveAsOf ||
			row.corpusSelectionHash !== corpus.corpusSelectionHash
		) {
			return null;
		}

		const parsedSnapshot = explorerHistorySnapshotSchema.safeParse(row.answerSnapshot);
		if (!parsedSnapshot.success || parsedSnapshot.data.status !== "answered") {
			return null;
		}

		const parsedSourceVersionIds = explorerHistoryCorpusVersionIdsSchema.safeParse(row.sourceVersionIds);
		if (!parsedSourceVersionIds.success) {
			return null;
		}

		const runtimeReadyVersionIds = new Set(corpus.legalActVersionIds);
		if (!parsedSourceVersionIds.data.every((id) => runtimeReadyVersionIds.has(id))) {
			return null;
		}

		// Best-effort hit accounting — never allowed to turn an already-validated cache hit into
		// a failure for the user (same philosophy as the History write elsewhere in this module).
		try {
			await input.db
				.update(verifiedLegalAnswerCache)
				.set({ hitCount: sql`${verifiedLegalAnswerCache.hitCount} + 1`, lastHitAt: new Date() })
				.where(eq(verifiedLegalAnswerCache.id, row.id));
		} catch (error) {
			console.error(
				"[explorer-answer-cache] hit accounting failed (cache hit still served):",
				error instanceof Error ? error.message : "unknown error",
			);
		}

		return parsedSnapshot.data;
	} catch (error) {
		console.error(
			"[explorer-answer-cache] lookup failed, falling through to the normal pipeline:",
			error instanceof Error ? error.message : "unknown error",
		);
		return null;
	}
}

export interface RecordVerifiedAnswerInput {
	db: Db;
	question: string;
	corpus: ResolvedQueryCorpus;
	result: LegalAnswerResult;
	view: ExplorerAnswerView;
}

/**
 * Write-eligibility (ALL required): CURRENT corpus mode with a real pinned run resolved, the
 * pipeline completed with `status: "answered"`, and EVERY final cited source's
 * legalActVersionId both belongs to the exact resolved corpus's runtime-ready set AND carries
 * `provenCurrentAsOf` equal to that same run's `effectiveAsOf` (see the current-corpus
 * provenance fix in packing.ts/answer.ts) — never a source proven current by some OTHER run,
 * never an unproven one. Never caches `insufficient_evidence`, partial/demoted output, or a
 * result touching any source outside the resolved corpus. Best-effort: never throws — a write
 * failure must never turn an already-successful answer into a user-facing error.
 */
export async function recordVerifiedAnswer(input: RecordVerifiedAnswerInput): Promise<void> {
	if (!hasCurrentCorpusIdentity(input.corpus)) {
		return;
	}
	const corpus = input.corpus;

	if (input.result.status !== "answered" || input.view.status !== "answered") {
		return;
	}

	const citedSupport = [...input.result.conclusions, ...input.result.alternativePaths].flatMap((item) => item.support);
	if (citedSupport.length === 0) {
		return;
	}

	const runtimeReadyVersionIds = new Set(corpus.legalActVersionIds);
	const allSourcesValidForThisRun = citedSupport.every(
		(source) => source.provenCurrentAsOf === corpus.effectiveAsOf && runtimeReadyVersionIds.has(source.legalActVersionId),
	);
	if (!allSourcesValidForThisRun) {
		return;
	}

	const parsedSnapshot = explorerHistorySnapshotSchema.safeParse(input.view);
	if (!parsedSnapshot.success) {
		return;
	}

	const sourceVersionIds = [...new Set(citedSupport.map((source) => source.legalActVersionId))].sort();
	// Auditability only — deliberately never consulted by lookupVerifiedAnswer's validation.
	const sourcePackHash = createHash("sha256")
		.update(
			JSON.stringify(
				[...citedSupport]
					.sort((a, b) => a.legalProvisionId.localeCompare(b.legalProvisionId))
					.map((source) => ({ legalProvisionId: source.legalProvisionId, citationLabel: source.citationLabel })),
			),
		)
		.digest("hex");

	const questionHash = hashNormalizedQuestion(normalizeQuestionForCache(input.question));

	try {
		await input.db
			.insert(verifiedLegalAnswerCache)
			.values({
				questionHash,
				corpusRunId: corpus.corpusRunId,
				rulesetVersion: corpus.rulesetVersion,
				effectiveAsOf: corpus.effectiveAsOf,
				corpusSelectionHash: corpus.corpusSelectionHash,
				pipelineVersion: LEGAL_ANSWER_PIPELINE_VERSION,
				answerSnapshot: parsedSnapshot.data,
				sourceVersionIds,
				sourcePackHash,
			})
			// Idempotent/conflict-safe: concurrent identical first misses may both compute and
			// attempt to insert the same verified answer — the first writer wins, the second is a
			// silent no-op, never a duplicate row and never a thrown unique-constraint error.
			.onConflictDoNothing({
				target: [verifiedLegalAnswerCache.questionHash, verifiedLegalAnswerCache.corpusRunId, verifiedLegalAnswerCache.pipelineVersion],
			});
	} catch (error) {
		console.error(
			"[explorer-answer-cache] write failed (answer already returned to the user):",
			error instanceof Error ? error.message : "unknown error",
		);
	}
}
