import type { CurrentLawDecision, CurrentLawReasonCode } from "./reason-codes";

export interface CurrentLawRelatedActInfo {
	sourceId: string;
	promulgationDate: string | null;
	expirationDate: string | null;
	entryIntoForceDate: string | null;
}

export interface CurrentLawRelationInput {
	relationType: string;
	relatedLegalActId: string | null;
	relatedSourceId: string;
}

export interface CurrentLawVersionInput {
	id: string;
	versionKind: string;
	sourceExpressionId: string;
	sourceAnnouncementLegalActId: string | null;
	authorityClass: string;
	hasStructure: boolean;
	legalStateDate: string | null;
	/**
	 * Row creation time — used ONLY to deterministically pick among multiple immutable PARSED
	 * CONTENT REVISIONS of the SAME announcement (see content-hash.ts / consolidated-ingest.ts):
	 * once a parser fix produces a corrected revision, more than one `legal_act_versions` row can
	 * legitimately share one `sourceAnnouncementLegalActId`. This is purely a technical
	 * content-revision tie-break, never a legal-effective-date comparison — that's what
	 * `legalStateDate` is for, and it stays untouched here.
	 */
	createdAt: string;
}

export interface CurrentLawCandidateInput {
	legalAct: {
		id: string;
		sourceId: string;
		inForce: boolean | null;
		expirationDate: string | null;
	};
	/** All legal_act_versions rows for this act. Never the primary source of "what TJs exist" — only used to check whether a version already exists/hasStructure for a given announcement. */
	versions: CurrentLawVersionInput[];
	/** Base act's ACTIVE relations, restricted to consolidated_text_announcement / correction / constitutional_tribunal. post_consolidated_amendment must never appear here. */
	baseActiveRelations: CurrentLawRelationInput[];
	/** Every known announcement act's OWN active relations, keyed by that announcement's legalActId. Used exclusively for that announcement's post_consolidated_amendment (and correction) relations. */
	announcementActiveRelationsById: Map<string, CurrentLawRelationInput[]>;
	/** legal_acts rows for every relatedLegalActId referenced above, keyed by id. Absence of an entry here IS "metadata unresolved" for that id. */
	relatedActsById: Map<string, CurrentLawRelatedActInfo>;
}

export interface CurrentLawSelectionOutcome {
	legalActId: string;
	decision: CurrentLawDecision;
	reasonCode: CurrentLawReasonCode;
	legalActVersionId: string | null;
	evidence: Record<string, unknown>;
}

function outcome(
	legalActId: string,
	decision: CurrentLawDecision,
	reasonCode: CurrentLawReasonCode,
	legalActVersionId: string | null,
	evidence: Record<string, unknown>,
): CurrentLawSelectionOutcome {
	return { legalActId, decision, reasonCode, legalActVersionId, evidence };
}

function isMatchingTjVersion(version: CurrentLawVersionInput, announcementLegalActId: string): boolean {
	return (
		version.versionKind === "consolidated" &&
		version.sourceExpressionId === "tj" &&
		version.authorityClass === "authoritative" &&
		version.sourceAnnouncementLegalActId === announcementLegalActId
	);
}

/**
 * Pure Model A ("pl-current-law-v1") evaluation for one base act — no DB or network access.
 * Reads only already-fetched rows (see CurrentLawCandidateInput). Every branch fails closed:
 * an unresolved/ambiguous/incomplete piece of evidence excludes, it never includes on a guess.
 *
 * Dates are kept semantically distinct and never conflated:
 * - legalStateDate (on a TJ version row): the state-of-law date the consolidated text itself
 *   reflects. Display/tie-break only — never the "was this TJ available as of X" boundary.
 * - promulgationDate (on the announcement act's legalActs row): when that TJ announcement was
 *   officially published. This IS the "available as of X" boundary.
 * - expirationDate (on the announcement act's legalActs row): set once a newer announcement
 *   supersedes it — corroborating evidence used alongside promulgationDate.
 * - effectiveAsOf: the caller-supplied date the corpus run claims to represent.
 */
export function evaluateCurrentLawCandidate(
	input: CurrentLawCandidateInput,
	effectiveAsOf: string,
): CurrentLawSelectionOutcome {
	const { legalAct, versions, baseActiveRelations, announcementActiveRelationsById, relatedActsById } = input;

	if (legalAct.inForce !== true) {
		return outcome(legalAct.id, "excluded", "act_not_in_force", null, {
			effectiveAsOf,
			checks: { inForce: legalAct.inForce },
		});
	}
	if (legalAct.expirationDate !== null && legalAct.expirationDate <= effectiveAsOf) {
		return outcome(legalAct.id, "excluded", "act_not_in_force", null, {
			effectiveAsOf,
			checks: { actExpirationDate: legalAct.expirationDate },
		});
	}

	// Step 2: the official announcement chain is read from the base act's active relations —
	// never inferred from whichever legal_act_versions rows happen to exist in the DB.
	const chain = baseActiveRelations.filter((r) => r.relationType === "consolidated_text_announcement");
	if (chain.length === 0) {
		return outcome(legalAct.id, "excluded", "no_official_consolidated_version", null, {
			effectiveAsOf,
			checks: { announcementChainLength: 0 },
		});
	}

	// Step 3: every chain entry must resolve to real metadata before applicability can be
	// determined safely — an unresolved/un-ingested chain entry fails closed.
	const resolvedChain: Array<{
		relatedLegalActId: string;
		relatedSourceId: string;
		info: CurrentLawRelatedActInfo;
	}> = [];
	for (const entry of chain) {
		if (!entry.relatedLegalActId) {
			return outcome(legalAct.id, "excluded", "metadata_incomplete", null, {
				effectiveAsOf,
				announcementChain: chain,
				checks: { unresolvedChainEntry: entry.relatedSourceId },
			});
		}
		const info = relatedActsById.get(entry.relatedLegalActId);
		if (!info) {
			return outcome(legalAct.id, "excluded", "metadata_incomplete", null, {
				effectiveAsOf,
				announcementChain: chain,
				checks: { unresolvedMetadataFor: entry.relatedSourceId },
			});
		}
		resolvedChain.push({ relatedLegalActId: entry.relatedLegalActId, relatedSourceId: entry.relatedSourceId, info });
	}

	// Step 4: an announcement is applicable as of X iff promulgated on/before X and not yet
	// superseded (expirationDate null or after X).
	const applicable = resolvedChain.filter(
		(c) =>
			c.info.promulgationDate !== null &&
			c.info.promulgationDate <= effectiveAsOf &&
			(c.info.expirationDate === null || c.info.expirationDate > effectiveAsOf),
	);

	if (applicable.length === 0) {
		return outcome(legalAct.id, "excluded", "no_official_consolidated_version", null, {
			effectiveAsOf,
			announcementChain: resolvedChain.map((c) => c.relatedSourceId),
			checks: { applicableCount: 0 },
		});
	}
	if (applicable.length > 1) {
		// Ambiguous applicability (inconsistent/incomplete expirationDate data) must never be
		// resolved by guessing the newest — fail closed.
		return outcome(legalAct.id, "excluded", "metadata_incomplete", null, {
			effectiveAsOf,
			announcementChain: resolvedChain.map((c) => c.relatedSourceId),
			checks: { ambiguousApplicability: true, applicableSourceIds: applicable.map((c) => c.relatedSourceId) },
		});
	}

	const selectedAnnouncement = applicable[0];

	// Step 5: find a matching, well-formed immutable TJ version for the selected announcement.
	// Matching is validated on every relevant field, not sourceAnnouncementLegalActId alone —
	// a malformed/inconsistent row (wrong versionKind/sourceExpressionId/authorityClass) is
	// treated as absent evidence, never trusted.
	//
	// More than one row can now legitimately match: a parser fix produces a NEW immutable content
	// revision for the SAME announcement rather than replacing the old one in place (see
	// content-hash.ts). Among all valid matches, deterministically prefer the MOST RECENTLY
	// created content revision (ties broken by id) — "latest successfully parsed content
	// compatible with the current parser/content rules", never the legal announcement's own date
	// (that's `selectedAnnouncement`, already fixed above; this is purely a technical
	// content-revision tie-break among rows that all share the same announcement).
	const rawMatches = versions.filter(
		(v) => v.sourceAnnouncementLegalActId === selectedAnnouncement.relatedLegalActId,
	);
	const validMatches = rawMatches
		.filter((v) => isMatchingTjVersion(v, selectedAnnouncement.relatedLegalActId))
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
	const validMatch = validMatches[0];

	if (rawMatches.length > 0 && !validMatch) {
		return outcome(legalAct.id, "excluded", "metadata_incomplete", null, {
			effectiveAsOf,
			selectedAnnouncementLegalActId: selectedAnnouncement.relatedLegalActId,
			checks: { malformedVersionRow: true, candidateVersionIds: rawMatches.map((v) => v.id) },
		});
	}

	if (!validMatch || !validMatch.hasStructure) {
		return outcome(legalAct.id, "excluded", "latest_tj_content_unavailable", null, {
			effectiveAsOf,
			selectedAnnouncementLegalActId: selectedAnnouncement.relatedLegalActId,
			checks: { versionExists: Boolean(validMatch), hasStructure: validMatch?.hasStructure ?? false },
		});
	}

	const selectedVersion = validMatch;

	// Step 6: amendment relations belong to the SELECTED ANNOUNCEMENT's own active relations,
	// never the base act's.
	const announcementRelations = announcementActiveRelationsById.get(selectedAnnouncement.relatedLegalActId) ?? [];
	const amendmentRelations = announcementRelations.filter((r) => r.relationType === "post_consolidated_amendment");
	const amendmentChecks: Array<Record<string, unknown>> = [];
	for (const rel of amendmentRelations) {
		const info = rel.relatedLegalActId ? relatedActsById.get(rel.relatedLegalActId) : undefined;
		if (!rel.relatedLegalActId || !info || info.entryIntoForceDate === null) {
			amendmentChecks.push({ relatedSourceId: rel.relatedSourceId, resolved: false });
			return outcome(legalAct.id, "excluded", "unresolved_temporal_effect", null, {
				effectiveAsOf,
				selectedVersionId: selectedVersion.id,
				amendmentChecks,
				amendmentRelationsSource: "announcement",
			});
		}
		if (info.entryIntoForceDate <= effectiveAsOf) {
			amendmentChecks.push({
				relatedSourceId: rel.relatedSourceId,
				entryIntoForceDate: info.entryIntoForceDate,
				alreadyEffective: true,
			});
			return outcome(legalAct.id, "excluded", "effective_post_tj_amendment", null, {
				effectiveAsOf,
				selectedVersionId: selectedVersion.id,
				amendmentChecks,
				amendmentRelationsSource: "announcement",
			});
		}
		amendmentChecks.push({
			relatedSourceId: rel.relatedSourceId,
			entryIntoForceDate: info.entryIntoForceDate,
			alreadyEffective: false,
		});
	}

	// Step 7: correction relations fail closed regardless of whether they're attached to the
	// base act or the selected announcement — checked on both, never mixed with the amendment
	// check above. Constitutional Tribunal relations remain base-act-scoped evidence.
	const announcementCorrection = announcementRelations.find((r) => r.relationType === "correction");
	const baseCorrection = baseActiveRelations.find((r) => r.relationType === "correction");
	const correctionHit = announcementCorrection ?? baseCorrection;
	if (correctionHit) {
		return outcome(legalAct.id, "excluded", "correction_unresolved", null, {
			effectiveAsOf,
			selectedVersionId: selectedVersion.id,
			amendmentChecks,
			checks: {
				correctionOn: announcementCorrection ? "announcement" : "base_act",
				relatedSourceId: correctionHit.relatedSourceId,
			},
		});
	}

	// Step 8: a Constitutional Tribunal relation on the base act is "absorbed" — does not block
	// inclusion — iff its related act's entryIntoForceDate (the ruling's actual legal-effect
	// date, correctly handling a deferred/postponed effect, never its publication date) is on or
	// before the SELECTED TJ version's legalStateDate. That date is the government's own
	// certified "state of law" declaration (art. 16 ustawy o ogłaszaniu aktów normatywnych
	// requires it to already reflect every TK effect as of that date) — so this defers entirely
	// to the official record and never interprets a ruling's substance. Every TK relation is
	// checked individually; any one unresolved relation fails the whole act closed.
	const tkRelations = baseActiveRelations.filter((r) => r.relationType === "constitutional_tribunal");
	const tkChecks: Array<Record<string, unknown>> = [];
	for (const rel of tkRelations) {
		const info = rel.relatedLegalActId ? relatedActsById.get(rel.relatedLegalActId) : undefined;
		if (!rel.relatedLegalActId || !info || info.entryIntoForceDate === null || selectedVersion.legalStateDate === null) {
			tkChecks.push({ relatedSourceId: rel.relatedSourceId, resolved: false });
			return outcome(legalAct.id, "excluded", "unresolved_constitutional_tribunal_effect", null, {
				effectiveAsOf,
				selectedVersionId: selectedVersion.id,
				amendmentChecks,
				tkChecks,
			});
		}
		if (info.entryIntoForceDate > selectedVersion.legalStateDate) {
			tkChecks.push({
				relatedSourceId: rel.relatedSourceId,
				entryIntoForceDate: info.entryIntoForceDate,
				resolved: false,
			});
			return outcome(legalAct.id, "excluded", "unresolved_constitutional_tribunal_effect", null, {
				effectiveAsOf,
				selectedVersionId: selectedVersion.id,
				amendmentChecks,
				tkChecks,
			});
		}
		tkChecks.push({
			relatedSourceId: rel.relatedSourceId,
			entryIntoForceDate: info.entryIntoForceDate,
			resolved: true,
		});
	}

	return outcome(legalAct.id, "included", "authoritative_current", selectedVersion.id, {
		effectiveAsOf,
		announcementChain: resolvedChain.map((c) => c.relatedSourceId),
		selectedAnnouncementLegalActId: selectedAnnouncement.relatedLegalActId,
		selectedVersionId: selectedVersion.id,
		// Auditability: how many immutable content revisions existed for this announcement, and
		// which one (the most recently created) was actually selected — never silent when more
		// than one parser output ever existed for the same official text.
		contentRevisionCandidateCount: validMatches.length,
		amendmentChecks,
		tkChecks,
		amendmentRelationsSource: "announcement",
		correctionTkRelationsSource: "base_act_and_announcement",
	});
}
