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

	it("excludes with unresolved_constitutional_tribunal_effect for an active TK relation on the base act", () => {
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
});
