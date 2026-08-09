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
];
