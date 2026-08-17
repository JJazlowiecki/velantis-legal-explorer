import type { CurrentLawCorpusScopeEntry } from "./service";

/**
 * Checked-in, minimal bootstrap scope for the current-law corpus milestone. Identity is a
 * base act's ELI sourceId, NEVER a legalActVersion UUID — a scope entry may resolve to zero DB
 * rows (not yet ingested) or to a real act that Model A is EXPECTED to exclude (KC, KK). These
 * expected exclusions are valuable, intentional test cases, not mistakes to fix.
 */
export const CURRENT_LAW_BOOTSTRAP_SCOPE: CurrentLawCorpusScopeEntry[] = [
	// Flagship acts kept as explicit evaluation targets even though they are expected to fail
	// closed under Model A (see the milestone's final report for observed reasons).
	{ sourceId: "DU/1964/93", label: "Kodeks cywilny (KC)" },
	{ sourceId: "DU/1960/168", label: "Kodeks postępowania administracyjnego (KPA)" },
	{ sourceId: "DU/1997/553", label: "Kodeks karny (KK)" },

	// Smaller acts re-confirmed live against the ELI API (status "akt posiada tekst jednolity",
	// textHTML=true) as candidates that might genuinely pass Model A once fully prepared. Not
	// guaranteed — corpus:generate reports the real outcome for each.
	{ sourceId: "DU/2017/2184", label: "Ustawa o Ogólnopolskiej Sieci Edukacyjnej" },
	{ sourceId: "DU/2001/1402", label: "Ustawa o ochronie baz danych" },
	{ sourceId: "DU/2018/1735", label: "Ustawa o Polskim Instytucie Ekonomicznym" },
	{ sourceId: "DU/2023/1073", label: "Ustawa o świadczeniu za pełnienie funkcji sołtysa" },
	{ sourceId: "DU/1997/681", label: "Ustawa o publicznej służbie krwi" },

	// Corpus Expansion v2 targets. Live ELI reference research (2026-08-17) predicts KPC, KPK,
	// KP, and Ustawa o prawach konsumenta will fail closed under Model A (each has at least one
	// already-effective post-TJ amendment with no newer official TJ to absorb it) while KRO and
	// UOKiK have zero post-TJ events and are expected to pass. Kept in scope regardless — a
	// correct exclusion is a valid outcome, and a future newer TJ resolves the blocked ones
	// automatically with no code change.
	{ sourceId: "DU/1964/296", label: "Kodeks postępowania cywilnego (KPC)" },
	{ sourceId: "DU/1997/555", label: "Kodeks postępowania karnego (KPK)" },
	{ sourceId: "DU/1974/141", label: "Kodeks pracy (KP)" },
	{ sourceId: "DU/1964/59", label: "Kodeks rodzinny i opiekuńczy (KRO)" },
	{ sourceId: "DU/2014/827", label: "Ustawa o prawach konsumenta" },
	{ sourceId: "DU/2007/331", label: "Ustawa o ochronie konkurencji i konsumentów (UOKiK)" },

	// Corpus Expansion v3 targets. Live ELI reference research (2026-08-17) confirmed zero
	// effective post-TJ amendments and zero unresolved TK relations for all six as of their
	// latest official TJ — expected to pass Model A. Prepared via --current-only (latest
	// authoritative consolidated text only, no historical chain).
	{ sourceId: "DU/2001/733", label: "Ustawa o ochronie praw lokatorów" },
	// DU/1994/388 (Ustawa o własności lokali) was evaluated but its --current-only preparation
	// fails closed: an old (2000) chain announcement's ELI record has no `promulgation` field at
	// all, so the latest-announcement resolver correctly refuses to guess. A systemic gap in
	// very old ELI records, not act-specific — recorded and excluded per this milestone's scope,
	// not patched here.
	{ sourceId: "DU/2011/715", label: "Ustawa o kredycie konsumenckim" },
	{ sourceId: "DU/1982/147", label: "Ustawa o księgach wieczystych i hipotece" },
	{ sourceId: "DU/2003/535", label: "Prawo upadłościowe" },
	{ sourceId: "DU/2002/1270", label: "Prawo o postępowaniu przed sądami administracyjnymi (PSA)" },
	{ sourceId: "DU/2015/978", label: "Prawo restrukturyzacyjne" },
];
