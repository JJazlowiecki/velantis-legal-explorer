import { describe, expect, it } from "vitest";

import {
	evaluateCurrentLawCandidate,
	type CurrentLawCandidateInput,
	type CurrentLawRelatedActInfo,
	type CurrentLawRelationInput,
	type CurrentLawVersionInput,
} from "./select";

const ACT_ID = "act-1";
const ANNOUNCEMENT_OLD_ID = "announcement-old";
const ANNOUNCEMENT_NEW_ID = "announcement-new";
const AMENDMENT_ID = "amendment-1";

function baseAct(overrides: Partial<CurrentLawCandidateInput["legalAct"]> = {}) {
	return { id: ACT_ID, sourceId: "DU/2000/1", inForce: true, expirationDate: null, ...overrides };
}

function announcementChainRelation(
	relatedLegalActId: string | null,
	relatedSourceId: string,
): CurrentLawRelationInput {
	return { relationType: "consolidated_text_announcement", relatedLegalActId, relatedSourceId };
}

function tjVersion(overrides: Partial<CurrentLawVersionInput> & { id: string }): CurrentLawVersionInput {
	return {
		versionKind: "consolidated",
		sourceExpressionId: "tj",
		sourceAnnouncementLegalActId: null,
		authorityClass: "authoritative",
		hasStructure: true,
		legalStateDate: null,
		createdAt: "2024-01-01T00:00:00.000Z",
		...overrides,
	};
}

function relatedAct(overrides: Partial<CurrentLawRelatedActInfo> = {}): CurrentLawRelatedActInfo {
	return { sourceId: "DU/x/x", promulgationDate: null, expirationDate: null, entryIntoForceDate: null, ...overrides };
}

function input(overrides: Partial<CurrentLawCandidateInput> = {}): CurrentLawCandidateInput {
	return {
		legalAct: baseAct(),
		versions: [],
		baseActiveRelations: [],
		announcementActiveRelationsById: new Map(),
		relatedActsById: new Map(),
		...overrides,
	};
}

const EFFECTIVE_AS_OF = "2026-08-09";

describe("evaluateCurrentLawCandidate — Model A (pl-current-law-v1)", () => {
	it("excludes when the act is not in force", () => {
		const result = evaluateCurrentLawCandidate(input({ legalAct: baseAct({ inForce: false }) }), EFFECTIVE_AS_OF);
		expect(result).toMatchObject({ decision: "excluded", reasonCode: "act_not_in_force", legalActVersionId: null });
	});

	it("excludes when the act's own expirationDate is on/before effectiveAsOf", () => {
		const result = evaluateCurrentLawCandidate(
			input({ legalAct: baseAct({ expirationDate: "2026-01-01" }) }),
			EFFECTIVE_AS_OF,
		);
		expect(result.reasonCode).toBe("act_not_in_force");
	});

	it("excludes with no_official_consolidated_version when the announcement chain is empty", () => {
		const result = evaluateCurrentLawCandidate(input(), EFFECTIVE_AS_OF);
		expect(result).toMatchObject({ decision: "excluded", reasonCode: "no_official_consolidated_version" });
	});

	it("fails closed with metadata_incomplete when a chain relation has no relatedLegalActId", () => {
		const result = evaluateCurrentLawCandidate(
			input({ baseActiveRelations: [announcementChainRelation(null, "DU/2024/1")] }),
			EFFECTIVE_AS_OF,
		);
		expect(result.reasonCode).toBe("metadata_incomplete");
		expect(result.legalActVersionId).toBeNull();
	});

	it("fails closed with metadata_incomplete when a chain announcement's metadata was never ingested", () => {
		const result = evaluateCurrentLawCandidate(
			input({ baseActiveRelations: [announcementChainRelation(ANNOUNCEMENT_NEW_ID, "DU/2024/1")] }),
			EFFECTIVE_AS_OF,
		);
		expect(result.reasonCode).toBe("metadata_incomplete");
	});

	it("excludes with no_official_consolidated_version when no known announcement is applicable as of X", () => {
		const result = evaluateCurrentLawCandidate(
			input({
				baseActiveRelations: [announcementChainRelation(ANNOUNCEMENT_NEW_ID, "DU/2027/1")],
				relatedActsById: new Map([[ANNOUNCEMENT_NEW_ID, relatedAct({ promulgationDate: "2027-01-01" })]]),
			}),
			EFFECTIVE_AS_OF,
		);
		expect(result.reasonCode).toBe("no_official_consolidated_version");
	});

	it("fails closed with metadata_incomplete when more than one announcement is simultaneously applicable (ambiguous expirationDate)", () => {
		const result = evaluateCurrentLawCandidate(
			input({
				baseActiveRelations: [
					announcementChainRelation(ANNOUNCEMENT_OLD_ID, "DU/2020/1"),
					announcementChainRelation(ANNOUNCEMENT_NEW_ID, "DU/2024/1"),
				],
				relatedActsById: new Map([
					[ANNOUNCEMENT_OLD_ID, relatedAct({ promulgationDate: "2020-01-01", expirationDate: null })],
					[ANNOUNCEMENT_NEW_ID, relatedAct({ promulgationDate: "2024-01-01", expirationDate: null })],
				]),
			}),
			EFFECTIVE_AS_OF,
		);
		expect(result.decision).toBe("excluded");
		expect(result.reasonCode).toBe("metadata_incomplete");
		expect(result.legalActVersionId).toBeNull();
	});

	it("(KC scenario) fails closed with latest_tj_content_unavailable when the applicable announcement has no matching version, even though an OLDER superseded announcement has a fully structured one", () => {
		const result = evaluateCurrentLawCandidate(
			input({
				baseActiveRelations: [
					announcementChainRelation(ANNOUNCEMENT_OLD_ID, "DU/2024/1061"),
					announcementChainRelation(ANNOUNCEMENT_NEW_ID, "DU/2026/795"),
				],
				relatedActsById: new Map([
					[ANNOUNCEMENT_OLD_ID, relatedAct({ promulgationDate: "2024-01-01", expirationDate: "2026-01-01" })],
					[ANNOUNCEMENT_NEW_ID, relatedAct({ promulgationDate: "2026-01-01", expirationDate: null })],
				]),
				versions: [
					tjVersion({ id: "v-old", sourceAnnouncementLegalActId: ANNOUNCEMENT_OLD_ID, hasStructure: true }),
				],
			}),
			EFFECTIVE_AS_OF,
		);
		expect(result.decision).toBe("excluded");
		expect(result.reasonCode).toBe("latest_tj_content_unavailable");
		expect(result.legalActVersionId).toBeNull();
	});

	it("fails closed with latest_tj_content_unavailable when the matching version exists but lacks structure", () => {
		const result = evaluateCurrentLawCandidate(
			input({
				baseActiveRelations: [announcementChainRelation(ANNOUNCEMENT_NEW_ID, "DU/2024/1")],
				relatedActsById: new Map([[ANNOUNCEMENT_NEW_ID, relatedAct({ promulgationDate: "2024-01-01" })]]),
				versions: [
					tjVersion({ id: "v-new", sourceAnnouncementLegalActId: ANNOUNCEMENT_NEW_ID, hasStructure: false }),
				],
			}),
			EFFECTIVE_AS_OF,
		);
		expect(result.reasonCode).toBe("latest_tj_content_unavailable");
	});

	it("fails closed with metadata_incomplete when a version row matches the announcement id but is malformed (wrong authorityClass)", () => {
		const result = evaluateCurrentLawCandidate(
			input({
				baseActiveRelations: [announcementChainRelation(ANNOUNCEMENT_NEW_ID, "DU/2024/1")],
				relatedActsById: new Map([[ANNOUNCEMENT_NEW_ID, relatedAct({ promulgationDate: "2024-01-01" })]]),
				versions: [
					tjVersion({
						id: "v-bad",
						sourceAnnouncementLegalActId: ANNOUNCEMENT_NEW_ID,
						authorityClass: "non_authoritative",
					}),
				],
			}),
			EFFECTIVE_AS_OF,
		);
		expect(result.reasonCode).toBe("metadata_incomplete");
	});

	it("an amendment relation on the BASE act (not the announcement) does NOT exclude", () => {
		const result = evaluateCurrentLawCandidate(
			input({
				baseActiveRelations: [
					announcementChainRelation(ANNOUNCEMENT_NEW_ID, "DU/2024/1"),
					{ relationType: "post_consolidated_amendment", relatedLegalActId: AMENDMENT_ID, relatedSourceId: "DU/2025/1" },
				],
				relatedActsById: new Map([[ANNOUNCEMENT_NEW_ID, relatedAct({ promulgationDate: "2024-01-01" })]]),
				versions: [tjVersion({ id: "v-new", sourceAnnouncementLegalActId: ANNOUNCEMENT_NEW_ID })],
			}),
			EFFECTIVE_AS_OF,
		);
		expect(result.decision).toBe("included");
	});

	it("excludes with effective_post_tj_amendment when the announcement's own amendment already entered into force on/before effectiveAsOf", () => {
		const result = evaluateCurrentLawCandidate(
			input({
				baseActiveRelations: [announcementChainRelation(ANNOUNCEMENT_NEW_ID, "DU/2024/1")],
				relatedActsById: new Map([
					[ANNOUNCEMENT_NEW_ID, relatedAct({ promulgationDate: "2024-01-01" })],
					[AMENDMENT_ID, relatedAct({ entryIntoForceDate: "2026-01-01" })],
				]),
				versions: [tjVersion({ id: "v-new", sourceAnnouncementLegalActId: ANNOUNCEMENT_NEW_ID })],
				announcementActiveRelationsById: new Map([
					[
						ANNOUNCEMENT_NEW_ID,
						[{ relationType: "post_consolidated_amendment", relatedLegalActId: AMENDMENT_ID, relatedSourceId: "DU/2025/1" }],
					],
				]),
			}),
			EFFECTIVE_AS_OF,
		);
		expect(result.reasonCode).toBe("effective_post_tj_amendment");
		expect(result.legalActVersionId).toBeNull();
	});

	it("does NOT exclude when the announcement's amendment enters into force AFTER effectiveAsOf", () => {
		const result = evaluateCurrentLawCandidate(
			input({
				baseActiveRelations: [announcementChainRelation(ANNOUNCEMENT_NEW_ID, "DU/2024/1")],
				relatedActsById: new Map([
					[ANNOUNCEMENT_NEW_ID, relatedAct({ promulgationDate: "2024-01-01" })],
					[AMENDMENT_ID, relatedAct({ entryIntoForceDate: "2027-01-01" })],
				]),
				versions: [tjVersion({ id: "v-new", sourceAnnouncementLegalActId: ANNOUNCEMENT_NEW_ID })],
				announcementActiveRelationsById: new Map([
					[
						ANNOUNCEMENT_NEW_ID,
						[{ relationType: "post_consolidated_amendment", relatedLegalActId: AMENDMENT_ID, relatedSourceId: "DU/2025/1" }],
					],
				]),
			}),
			EFFECTIVE_AS_OF,
		);
		expect(result.decision).toBe("included");
		expect(result.legalActVersionId).toBe("v-new");
	});

	it("fails closed with unresolved_temporal_effect when the amendment's entryIntoForceDate cannot be resolved", () => {
		const result = evaluateCurrentLawCandidate(
			input({
				baseActiveRelations: [announcementChainRelation(ANNOUNCEMENT_NEW_ID, "DU/2024/1")],
				relatedActsById: new Map([[ANNOUNCEMENT_NEW_ID, relatedAct({ promulgationDate: "2024-01-01" })]]),
				versions: [tjVersion({ id: "v-new", sourceAnnouncementLegalActId: ANNOUNCEMENT_NEW_ID })],
				announcementActiveRelationsById: new Map([
					[
						ANNOUNCEMENT_NEW_ID,
						[{ relationType: "post_consolidated_amendment", relatedLegalActId: AMENDMENT_ID, relatedSourceId: "DU/2025/1" }],
					],
				]),
			}),
			EFFECTIVE_AS_OF,
		);
		expect(result.reasonCode).toBe("unresolved_temporal_effect");
	});

	it("excludes with correction_unresolved for a correction on the BASE act", () => {
		const result = evaluateCurrentLawCandidate(
			input({
				baseActiveRelations: [
					announcementChainRelation(ANNOUNCEMENT_NEW_ID, "DU/2024/1"),
					{ relationType: "correction", relatedLegalActId: null, relatedSourceId: "DU/2024/999" },
				],
				relatedActsById: new Map([[ANNOUNCEMENT_NEW_ID, relatedAct({ promulgationDate: "2024-01-01" })]]),
				versions: [tjVersion({ id: "v-new", sourceAnnouncementLegalActId: ANNOUNCEMENT_NEW_ID })],
			}),
			EFFECTIVE_AS_OF,
		);
		expect(result.reasonCode).toBe("correction_unresolved");
	});

	it("excludes with correction_unresolved for a correction attached to the ANNOUNCEMENT, not the base act", () => {
		const result = evaluateCurrentLawCandidate(
			input({
				baseActiveRelations: [announcementChainRelation(ANNOUNCEMENT_NEW_ID, "DU/2024/1")],
				relatedActsById: new Map([[ANNOUNCEMENT_NEW_ID, relatedAct({ promulgationDate: "2024-01-01" })]]),
				versions: [tjVersion({ id: "v-new", sourceAnnouncementLegalActId: ANNOUNCEMENT_NEW_ID })],
				announcementActiveRelationsById: new Map([
					[ANNOUNCEMENT_NEW_ID, [{ relationType: "correction", relatedLegalActId: null, relatedSourceId: "DU/2024/999" }]],
				]),
			}),
			EFFECTIVE_AS_OF,
		);
		expect(result.reasonCode).toBe("correction_unresolved");
	});

	it("excludes with unresolved_constitutional_tribunal_effect when a TK relation's relatedLegalActId is unresolved", () => {
		const result = evaluateCurrentLawCandidate(
			input({
				baseActiveRelations: [
					announcementChainRelation(ANNOUNCEMENT_NEW_ID, "DU/2024/1"),
					{ relationType: "constitutional_tribunal", relatedLegalActId: null, relatedSourceId: "TK/1" },
				],
				relatedActsById: new Map([[ANNOUNCEMENT_NEW_ID, relatedAct({ promulgationDate: "2024-01-01" })]]),
				versions: [tjVersion({ id: "v-new", sourceAnnouncementLegalActId: ANNOUNCEMENT_NEW_ID })],
			}),
			EFFECTIVE_AS_OF,
		);
		expect(result.reasonCode).toBe("unresolved_constitutional_tribunal_effect");
	});

	const TK_ID = "tk-1";

	function inputWithTk(
		tkInfo: CurrentLawRelatedActInfo | undefined,
		versionOverrides: Partial<CurrentLawVersionInput> = {},
		extraTkRelations: CurrentLawRelationInput[] = [],
	) {
		const relatedActsById = new Map([[ANNOUNCEMENT_NEW_ID, relatedAct({ promulgationDate: "2024-01-01" })]]);
		if (tkInfo) relatedActsById.set(TK_ID, tkInfo);
		return input({
			baseActiveRelations: [
				announcementChainRelation(ANNOUNCEMENT_NEW_ID, "DU/2024/1"),
				{ relationType: "constitutional_tribunal", relatedLegalActId: TK_ID, relatedSourceId: "DU/2020/1" },
				...extraTkRelations,
			],
			relatedActsById,
			versions: [tjVersion({ id: "v-new", sourceAnnouncementLegalActId: ANNOUNCEMENT_NEW_ID, ...versionOverrides })],
		});
	}

	it("resolves a TK event whose entryIntoForceDate is ON the TJ's legalStateDate (boundary is inclusive)", () => {
		const result = evaluateCurrentLawCandidate(
			inputWithTk(relatedAct({ entryIntoForceDate: "2024-06-01" }), { legalStateDate: "2024-06-01" }),
			EFFECTIVE_AS_OF,
		);
		expect(result.decision).toBe("included");
		expect(result.legalActVersionId).toBe("v-new");
	});

	it("resolves a TK event whose effect predates the selected TJ's legalStateDate", () => {
		const result = evaluateCurrentLawCandidate(
			inputWithTk(relatedAct({ entryIntoForceDate: "2020-05-01" }), { legalStateDate: "2025-01-01" }),
			EFFECTIVE_AS_OF,
		);
		expect(result.decision).toBe("included");
		expect(result.reasonCode).toBe("authoritative_current");
	});

	it("does NOT resolve a TK event whose effect (e.g. a deferred effective date) is AFTER the selected TJ's legalStateDate", () => {
		const result = evaluateCurrentLawCandidate(
			inputWithTk(relatedAct({ entryIntoForceDate: "2022-01-01" }), { legalStateDate: "2021-06-01" }),
			EFFECTIVE_AS_OF,
		);
		expect(result.decision).toBe("excluded");
		expect(result.reasonCode).toBe("unresolved_constitutional_tribunal_effect");
	});

	it("fails closed when the TK event's entryIntoForceDate is unknown, even with a resolved relatedLegalActId", () => {
		const result = evaluateCurrentLawCandidate(
			inputWithTk(relatedAct({ entryIntoForceDate: null }), { legalStateDate: "2025-01-01" }),
			EFFECTIVE_AS_OF,
		);
		expect(result.reasonCode).toBe("unresolved_constitutional_tribunal_effect");
	});

	it("fails closed when the selected TJ has no legalStateDate to compare against", () => {
		const result = evaluateCurrentLawCandidate(
			inputWithTk(relatedAct({ entryIntoForceDate: "2020-01-01" }), { legalStateDate: null }),
			EFFECTIVE_AS_OF,
		);
		expect(result.reasonCode).toBe("unresolved_constitutional_tribunal_effect");
	});

	it("blocks on the single unresolved event even when another TK relation on the same act IS resolved", () => {
		const result = evaluateCurrentLawCandidate(
			inputWithTk(
				relatedAct({ entryIntoForceDate: "2010-01-01" }), // resolved
				{ legalStateDate: "2025-01-01" },
				[{ relationType: "constitutional_tribunal", relatedLegalActId: null, relatedSourceId: "DU/2023/1" }], // unresolved
			),
			EFFECTIVE_AS_OF,
		);
		expect(result.decision).toBe("excluded");
		expect(result.reasonCode).toBe("unresolved_constitutional_tribunal_effect");
	});

	it("older TJ (earlier legalStateDate) cannot absorb a later-effect TK event that a newer TJ could", () => {
		const olderTjResult = evaluateCurrentLawCandidate(
			inputWithTk(relatedAct({ entryIntoForceDate: "2024-01-01" }), { legalStateDate: "2023-01-01" }),
			EFFECTIVE_AS_OF,
		);
		const newerTjResult = evaluateCurrentLawCandidate(
			inputWithTk(relatedAct({ entryIntoForceDate: "2024-01-01" }), { legalStateDate: "2025-01-01" }),
			EFFECTIVE_AS_OF,
		);
		expect(olderTjResult.reasonCode).toBe("unresolved_constitutional_tribunal_effect");
		expect(newerTjResult.decision).toBe("included");
	});

	it("an act with no TK relations at all is unaffected by the TK resolution rule", () => {
		const result = evaluateCurrentLawCandidate(
			input({
				baseActiveRelations: [announcementChainRelation(ANNOUNCEMENT_NEW_ID, "DU/2024/1")],
				relatedActsById: new Map([[ANNOUNCEMENT_NEW_ID, relatedAct({ promulgationDate: "2024-01-01" })]]),
				versions: [tjVersion({ id: "v-new", sourceAnnouncementLegalActId: ANNOUNCEMENT_NEW_ID })],
			}),
			EFFECTIVE_AS_OF,
		);
		expect(result.decision).toBe("included");
	});

	it("records the resolving TJ's legalStateDate and the event's source id in the included decision's evidence", () => {
		const result = evaluateCurrentLawCandidate(
			inputWithTk(relatedAct({ entryIntoForceDate: "2020-05-01" }), { legalStateDate: "2025-01-01" }),
			EFFECTIVE_AS_OF,
		);
		expect(result.evidence.tkChecks).toEqual([
			{
				relatedSourceId: "DU/2020/1",
				entryIntoForceDate: "2020-05-01",
				resolvingTjLegalStateDate: "2025-01-01",
				resolved: true,
			},
		]);
	});

	it("selects the announcement applicable AT a past effectiveAsOf, not the newest known today", () => {
		const pastDate = "2022-06-01";
		const result = evaluateCurrentLawCandidate(
			input({
				baseActiveRelations: [
					announcementChainRelation(ANNOUNCEMENT_OLD_ID, "DU/2020/1"),
					announcementChainRelation(ANNOUNCEMENT_NEW_ID, "DU/2024/1"),
				],
				relatedActsById: new Map([
					[ANNOUNCEMENT_OLD_ID, relatedAct({ promulgationDate: "2020-01-01", expirationDate: "2024-01-01" })],
					[ANNOUNCEMENT_NEW_ID, relatedAct({ promulgationDate: "2024-01-01", expirationDate: null })],
				]),
				versions: [
					tjVersion({ id: "v-old", sourceAnnouncementLegalActId: ANNOUNCEMENT_OLD_ID }),
					tjVersion({ id: "v-new", sourceAnnouncementLegalActId: ANNOUNCEMENT_NEW_ID }),
				],
			}),
			pastDate,
		);
		expect(result.decision).toBe("included");
		expect(result.legalActVersionId).toBe("v-old");
	});

	it("includes a genuinely qualifying act end-to-end with a fully populated evidence trail", () => {
		const result = evaluateCurrentLawCandidate(
			input({
				baseActiveRelations: [announcementChainRelation(ANNOUNCEMENT_NEW_ID, "DU/2024/1")],
				relatedActsById: new Map([[ANNOUNCEMENT_NEW_ID, relatedAct({ promulgationDate: "2024-01-01" })]]),
				versions: [tjVersion({ id: "v-new", sourceAnnouncementLegalActId: ANNOUNCEMENT_NEW_ID })],
			}),
			EFFECTIVE_AS_OF,
		);
		expect(result).toMatchObject({
			legalActId: ACT_ID,
			decision: "included",
			reasonCode: "authoritative_current",
			legalActVersionId: "v-new",
		});
		expect(result.evidence).toMatchObject({ selectedAnnouncementLegalActId: ANNOUNCEMENT_NEW_ID, selectedVersionId: "v-new" });
	});

	it("H: when multiple immutable content revisions exist for the SAME announcement (a parser fix produced a corrected re-parse), deterministically selects the MOST RECENTLY CREATED one — never the first in array order", () => {
		const result = evaluateCurrentLawCandidate(
			input({
				baseActiveRelations: [announcementChainRelation(ANNOUNCEMENT_NEW_ID, "DU/2024/1")],
				relatedActsById: new Map([[ANNOUNCEMENT_NEW_ID, relatedAct({ promulgationDate: "2024-01-01" })]]),
				versions: [
					// Deliberately listed newest-first to prove selection isn't "just take versions[0]".
					tjVersion({
						id: "v-corrected",
						sourceAnnouncementLegalActId: ANNOUNCEMENT_NEW_ID,
						createdAt: "2026-08-10T00:00:00.000Z",
					}),
					tjVersion({
						id: "v-old-parser-bug",
						sourceAnnouncementLegalActId: ANNOUNCEMENT_NEW_ID,
						createdAt: "2024-01-01T00:00:00.000Z",
					}),
				],
			}),
			EFFECTIVE_AS_OF,
		);
		expect(result.decision).toBe("included");
		expect(result.legalActVersionId).toBe("v-corrected");
		expect(result.evidence).toMatchObject({ contentRevisionCandidateCount: 2 });
	});

	it("a stale content revision that lacks structure is skipped in favor of an older-but-structured one for the SAME announcement", () => {
		const result = evaluateCurrentLawCandidate(
			input({
				baseActiveRelations: [announcementChainRelation(ANNOUNCEMENT_NEW_ID, "DU/2024/1")],
				relatedActsById: new Map([[ANNOUNCEMENT_NEW_ID, relatedAct({ promulgationDate: "2024-01-01" })]]),
				versions: [
					tjVersion({
						id: "v-newer-but-unindexed",
						sourceAnnouncementLegalActId: ANNOUNCEMENT_NEW_ID,
						createdAt: "2026-08-10T00:00:00.000Z",
						hasStructure: false,
					}),
					tjVersion({
						id: "v-older-structured",
						sourceAnnouncementLegalActId: ANNOUNCEMENT_NEW_ID,
						createdAt: "2024-01-01T00:00:00.000Z",
						hasStructure: true,
					}),
				],
			}),
			EFFECTIVE_AS_OF,
		);
		// isMatchingTjVersion doesn't check hasStructure — both are "valid" matches; hasStructure
		// is only checked on the eventually-chosen one. Documents the exact current fail-closed
		// behavior: the newest-created candidate wins the tie-break even if unstructured, and
		// THAT one then fails latest_tj_content_unavailable — it does not fall back to the older,
		// structured revision (matching the KC "never let an older successful parse rescue a
		// newer failed one" precedent already established for cross-announcement selection).
		expect(result.decision).toBe("excluded");
		expect(result.reasonCode).toBe("latest_tj_content_unavailable");
	});
});
