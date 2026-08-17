import { createHash } from "node:crypto";

import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema";
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
import { isSearchableProvision } from "../search/documents";
import { evaluateCurrentLawCandidate, type CurrentLawCandidateInput, type CurrentLawSelectionOutcome } from "./select";
import { RULESET_VERSION, type CurrentLawReasonCode } from "./reason-codes";

export class CurrentLawCorpusError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CurrentLawCorpusError";
	}
}

/**
 * pl-current-law-v1 only claims to represent the PRESENT state of law: stored `inForce`
 * metadata describes the act's current status, and this pipeline does not yet reconstruct
 * historical force periods. The schema stays effectiveAsOf-shaped so a future ruleset can add
 * real historical reconstruction, but v1 refuses to silently pretend it supports an arbitrary
 * past/future date. `now` is injectable so tests stay deterministic.
 */
function assertSupportedEffectiveAsOf(effectiveAsOf: string, now: Date): void {
	const today = now.toISOString().slice(0, 10);
	if (effectiveAsOf !== today) {
		throw new CurrentLawCorpusError(
			`rulesetVersion "${RULESET_VERSION}" only supports generating a corpus for the current date (${today}); received effectiveAsOf="${effectiveAsOf}". Historical reconstruction is not implemented in this ruleset.`,
		);
	}
}

export interface CurrentLawCorpusScopeEntry {
	sourceId: string;
	label: string;
}

export interface GenerateCurrentLawCorpusInput {
	db: PostgresJsDatabase<typeof schema>;
	effectiveAsOf: string;
	scope: CurrentLawCorpusScopeEntry[];
	now?: Date;
}

export interface GenerateCurrentLawCorpusResult {
	runId: string;
	status: "completed";
	effectiveAsOf: string;
	rulesetVersion: string;
	selectionHash: string;
	included: Array<{ legalActId: string; legalActVersionId: string; runtimeReady: boolean }>;
	excludedByReason: Partial<Record<CurrentLawReasonCode, number>>;
	unresolvedScope: string[];
	entries: CurrentLawSelectionOutcome[];
}

const CHAIN_RELATION_TYPES = ["consolidated_text_announcement", "correction", "constitutional_tribunal"];
const ANNOUNCEMENT_RELATION_TYPES = ["post_consolidated_amendment", "correction"];

async function loadCandidateInput(
	db: PostgresJsDatabase<typeof schema>,
	legalAct: { id: string; sourceId: string; inForce: boolean | null; expirationDate: string | null },
): Promise<CurrentLawCandidateInput> {
	const versionRows = await db
		.select({
			id: legalActVersions.id,
			versionKind: legalActVersions.versionKind,
			sourceExpressionId: legalActVersions.sourceExpressionId,
			sourceAnnouncementLegalActId: legalActVersions.sourceAnnouncementLegalActId,
			authorityClass: legalActVersions.authorityClass,
			legalStateDate: legalActVersions.legalStateDate,
			createdAt: legalActVersions.createdAt,
		})
		.from(legalActVersions)
		.where(eq(legalActVersions.legalActId, legalAct.id));

	const provisionCounts = await db
		.select({ legalActVersionId: legalProvisions.legalActVersionId })
		.from(legalProvisions)
		.where(
			inArray(
				legalProvisions.legalActVersionId,
				versionRows.map((v) => v.id),
			),
		);
	const hasStructureByVersion = new Set(provisionCounts.map((p) => p.legalActVersionId));

	const versions = versionRows.map((v) => ({
		...v,
		hasStructure: hasStructureByVersion.has(v.id),
		createdAt: v.createdAt.toISOString(),
	}));

	const baseRelations = await db
		.select({
			relationType: legalActRelations.relationType,
			relatedLegalActId: legalActRelations.relatedLegalActId,
			relatedSourceId: legalActRelations.relatedSourceId,
		})
		.from(legalActRelations)
		.where(
			and(
				eq(legalActRelations.legalActId, legalAct.id),
				eq(legalActRelations.isActive, true),
				inArray(legalActRelations.relationType, CHAIN_RELATION_TYPES),
			),
		);

	const announcementIds = [
		...new Set(
			baseRelations
				.filter((r) => r.relationType === "consolidated_text_announcement" && r.relatedLegalActId)
				.map((r) => r.relatedLegalActId as string),
		),
	];

	const announcementActiveRelationsById = new Map<string, typeof baseRelations>();
	if (announcementIds.length > 0) {
		const announcementRelations = await db
			.select({
				legalActId: legalActRelations.legalActId,
				relationType: legalActRelations.relationType,
				relatedLegalActId: legalActRelations.relatedLegalActId,
				relatedSourceId: legalActRelations.relatedSourceId,
			})
			.from(legalActRelations)
			.where(
				and(
					inArray(legalActRelations.legalActId, announcementIds),
					eq(legalActRelations.isActive, true),
					inArray(legalActRelations.relationType, ANNOUNCEMENT_RELATION_TYPES),
				),
			);
		for (const rel of announcementRelations) {
			const list = announcementActiveRelationsById.get(rel.legalActId) ?? [];
			list.push(rel);
			announcementActiveRelationsById.set(rel.legalActId, list);
		}
	}

	const amendmentIds = [
		...announcementActiveRelationsById.values(),
	]
		.flat()
		.filter((r) => r.relationType === "post_consolidated_amendment" && r.relatedLegalActId)
		.map((r) => r.relatedLegalActId as string);

	const tkIds = baseRelations
		.filter((r) => r.relationType === "constitutional_tribunal" && r.relatedLegalActId)
		.map((r) => r.relatedLegalActId as string);

	const relatedActIds = [...new Set([...announcementIds, ...amendmentIds, ...tkIds])];
	const relatedActsById = new Map<
		string,
		{ sourceId: string; promulgationDate: string | null; expirationDate: string | null; entryIntoForceDate: string | null }
	>();
	if (relatedActIds.length > 0) {
		const relatedActRows = await db
			.select({
				id: legalActs.id,
				sourceId: legalActs.sourceId,
				promulgationDate: legalActs.promulgationDate,
				expirationDate: legalActs.expirationDate,
				entryIntoForceDate: legalActs.entryIntoForceDate,
			})
			.from(legalActs)
			.where(inArray(legalActs.id, relatedActIds));
		for (const row of relatedActRows) {
			relatedActsById.set(row.id, {
				sourceId: row.sourceId,
				promulgationDate: row.promulgationDate,
				expirationDate: row.expirationDate,
				entryIntoForceDate: row.entryIntoForceDate,
			});
		}
	}

	return {
		legalAct,
		versions,
		baseActiveRelations: baseRelations,
		announcementActiveRelationsById,
		relatedActsById,
	};
}

async function computeRuntimeReady(db: PostgresJsDatabase<typeof schema>, legalActVersionId: string): Promise<boolean> {
	const provisionRows = await db
		.select({
			provisionType: legalProvisions.provisionType,
			heading: legalProvisions.heading,
			text: legalProvisions.text,
		})
		.from(legalProvisions)
		.where(eq(legalProvisions.legalActVersionId, legalActVersionId));
	const expectedSearchableCount = provisionRows.filter((p) => isSearchableProvision(p)).length;
	if (expectedSearchableCount === 0) return false;

	const embeddedCountRows = await db
		.select({ id: legalSearchDocuments.id })
		.from(legalSearchDocuments)
		.where(
			and(eq(legalSearchDocuments.legalActVersionId, legalActVersionId), isNotNull(legalSearchDocuments.embedding)),
		);
	const actualEmbeddedCount = embeddedCountRows.length;
	return actualEmbeddedCount === expectedSearchableCount;
}

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	if (value && typeof value === "object") {
		const obj = value as Record<string, unknown>;
		const keys = Object.keys(obj).sort();
		return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

export async function generateCurrentLawCorpus(
	input: GenerateCurrentLawCorpusInput,
): Promise<GenerateCurrentLawCorpusResult> {
	const now = input.now ?? new Date();
	assertSupportedEffectiveAsOf(input.effectiveAsOf, now);

	const unresolvedScope: string[] = [];
	const entries: CurrentLawSelectionOutcome[] = [];
	const runtimeReadyByVersionId = new Map<string, boolean>();

	for (const scopeEntry of input.scope) {
		const [actRow] = await input.db
			.select({
				id: legalActs.id,
				sourceId: legalActs.sourceId,
				inForce: legalActs.inForce,
				expirationDate: legalActs.expirationDate,
			})
			.from(legalActs)
			.where(and(eq(legalActs.source, ELI_SOURCE), eq(legalActs.sourceId, scopeEntry.sourceId)))
			.limit(1);

		if (!actRow) {
			unresolvedScope.push(scopeEntry.sourceId);
			continue;
		}

		const candidateInput = await loadCandidateInput(input.db, actRow);
		const decision = evaluateCurrentLawCandidate(candidateInput, input.effectiveAsOf);
		entries.push(decision);

		if (decision.decision === "included" && decision.legalActVersionId) {
			const ready = await computeRuntimeReady(input.db, decision.legalActVersionId);
			runtimeReadyByVersionId.set(decision.legalActVersionId, ready);
		}
	}

	const included = entries
		.filter((e) => e.decision === "included" && e.legalActVersionId)
		.map((e) => ({
			legalActId: e.legalActId,
			legalActVersionId: e.legalActVersionId as string,
			runtimeReady: runtimeReadyByVersionId.get(e.legalActVersionId as string) ?? false,
		}));

	const excludedByReason: Partial<Record<CurrentLawReasonCode, number>> = {};
	for (const e of entries) {
		if (e.decision === "excluded") {
			excludedByReason[e.reasonCode] = (excludedByReason[e.reasonCode] ?? 0) + 1;
		}
	}

	const sortedForHash = [...entries]
		.sort((a, b) => a.legalActId.localeCompare(b.legalActId))
		.map((e) => ({
			legalActId: e.legalActId,
			decision: e.decision,
			reasonCode: e.reasonCode,
			legalActVersionId: e.legalActVersionId,
		}));
	const selectionHash = createHash("sha256")
		.update(
			stableStringify({ rulesetVersion: RULESET_VERSION, effectiveAsOf: input.effectiveAsOf, entries: sortedForHash }),
		)
		.digest("hex");

	const summary = {
		scopeCount: input.scope.length,
		resolvedCount: entries.length,
		includedCount: included.length,
		unresolvedScope,
		excludedByReason,
	};

	const runId = await input.db.transaction(async (tx) => {
		const [run] = await tx
			.insert(currentLawCorpusRuns)
			.values({
				effectiveAsOf: input.effectiveAsOf,
				generatedAt: now,
				rulesetVersion: RULESET_VERSION,
				selectionHash,
				status: "completed",
				summary,
			})
			.returning({ id: currentLawCorpusRuns.id });

		if (entries.length > 0) {
			await tx.insert(currentLawCorpusEntries).values(
				entries.map((e) => ({
					runId: run.id,
					legalActId: e.legalActId,
					legalActVersionId: e.legalActVersionId,
					decision: e.decision,
					reasonCode: e.reasonCode,
					evidence: e.evidence,
					runtimeReady: e.legalActVersionId ? runtimeReadyByVersionId.get(e.legalActVersionId) ?? false : false,
				})),
			);
		}

		return run.id;
	});

	return {
		runId,
		status: "completed",
		effectiveAsOf: input.effectiveAsOf,
		rulesetVersion: RULESET_VERSION,
		selectionHash,
		included,
		excludedByReason,
		unresolvedScope,
		entries,
	};
}

export interface CurrentLawCorpusEntryView {
	legalActId: string;
	legalActVersionId: string | null;
	decision: "included" | "excluded";
	reasonCode: CurrentLawReasonCode;
	runtimeReady: boolean;
}

export interface CurrentLawCorpusRunView {
	runId: string;
	status: string;
	effectiveAsOf: string;
	rulesetVersion: string;
	selectionHash: string;
	generatedAt: Date;
	entries: CurrentLawCorpusEntryView[];
}

async function loadRunView(
	db: PostgresJsDatabase<typeof schema>,
	runRow: {
		id: string;
		status: string;
		effectiveAsOf: string;
		rulesetVersion: string;
		selectionHash: string;
		generatedAt: Date;
	},
): Promise<CurrentLawCorpusRunView> {
	const entryRows = await db
		.select({
			legalActId: currentLawCorpusEntries.legalActId,
			legalActVersionId: currentLawCorpusEntries.legalActVersionId,
			decision: currentLawCorpusEntries.decision,
			reasonCode: currentLawCorpusEntries.reasonCode,
			runtimeReady: currentLawCorpusEntries.runtimeReady,
		})
		.from(currentLawCorpusEntries)
		.where(eq(currentLawCorpusEntries.runId, runRow.id));

	return {
		runId: runRow.id,
		status: runRow.status,
		effectiveAsOf: runRow.effectiveAsOf,
		rulesetVersion: runRow.rulesetVersion,
		selectionHash: runRow.selectionHash,
		generatedAt: runRow.generatedAt,
		entries: entryRows.map((e) => ({
			legalActId: e.legalActId,
			legalActVersionId: e.legalActVersionId,
			decision: e.decision as "included" | "excluded",
			reasonCode: e.reasonCode as CurrentLawReasonCode,
			runtimeReady: e.runtimeReady,
		})),
	};
}

export async function getCurrentLawCorpusRun(input: {
	db: PostgresJsDatabase<typeof schema>;
	runId: string;
}): Promise<CurrentLawCorpusRunView | null> {
	const [runRow] = await input.db
		.select()
		.from(currentLawCorpusRuns)
		.where(eq(currentLawCorpusRuns.id, input.runId))
		.limit(1);
	if (!runRow) return null;
	return loadRunView(input.db, runRow);
}

/**
 * Admin/CLI convenience only — e.g. so `corpus:generate` can report "would this new run become
 * the latest usable one" in its summary. NEVER called by the Explorer runtime path, which
 * always resolves a single operator-pinned run id (see src/lib/explorer/corpus-config.ts) and
 * never implicitly substitutes a different "latest" run — a newer completed run can legitimately
 * exist precisely because new legal metadata made an older run's decisions unsafe.
 */
export async function getLatestUsableCurrentLawCorpus(input: {
	db: PostgresJsDatabase<typeof schema>;
	rulesetVersion?: string;
}): Promise<CurrentLawCorpusRunView | null> {
	const rulesetVersion = input.rulesetVersion ?? RULESET_VERSION;
	const runRows = await input.db
		.select()
		.from(currentLawCorpusRuns)
		.where(and(eq(currentLawCorpusRuns.rulesetVersion, rulesetVersion), eq(currentLawCorpusRuns.status, "completed")))
		.orderBy(currentLawCorpusRuns.generatedAt);

	for (const runRow of [...runRows].reverse()) {
		const view = await loadRunView(input.db, runRow);
		if (view.entries.some((e) => e.decision === "included" && e.runtimeReady)) {
			return view;
		}
	}
	return null;
}
