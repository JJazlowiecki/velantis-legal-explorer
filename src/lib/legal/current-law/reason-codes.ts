export const RULESET_VERSION = "pl-current-law-v1";

export const CURRENT_LAW_REASON_CODES = [
	"authoritative_current",
	"act_not_in_force",
	"no_official_consolidated_version",
	"latest_tj_content_unavailable",
	"currentness_unproven",
	"effective_post_tj_amendment",
	"unresolved_temporal_effect",
	"unresolved_constitutional_tribunal_effect",
	"correction_unresolved",
	"no_structure",
	"not_in_bootstrap_scope",
	"metadata_incomplete",
] as const;

export type CurrentLawReasonCode = (typeof CURRENT_LAW_REASON_CODES)[number];

export const CURRENT_LAW_DECISIONS = ["included", "excluded"] as const;
export type CurrentLawDecision = (typeof CURRENT_LAW_DECISIONS)[number];
