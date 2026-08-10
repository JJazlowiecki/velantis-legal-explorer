/**
 * CORE LEGAL ANSWER QUALITY v4 — Phase 14 regression suite. Curated against the current
 * runtime-ready 5-act corpus (see CURRENT_LAW_BOOTSTRAP_SCOPE). Measures STRUCTURAL quality,
 * never exact prose — see src/scripts/eval-legal-answer-quality.ts for the metrics actually
 * asserted/reported. `expectedCentralCitations` is a best-effort expectation (citationLabel
 * substrings expected to be CITED in a verified conclusion when the pipeline works correctly),
 * not a hard assertion baked into pipeline code — a miss is reported, never silently ignored,
 * but never throws.
 */
export type EvalCategory =
  | "A_direct_substantive_right"
  | "B_multi_condition"
  | "C_remedies"
  | "D_definitions"
  | "E_exclusions"
  | "F_procedural_conditions"
  | "G_multi_part"
  | "H_exact_citation"
  | "I_unrelated_non_legal"
  | "J_outside_corpus_scope";

export interface LegalAnswerEvalQuestion {
  id: string;
  category: EvalCategory;
  query: string;
  /** "answered" | "insufficient_evidence" | null (either is acceptable, e.g. adversarial cases). */
  expectedStatus: "answered" | "insufficient_evidence" | null;
  /** citationLabel substrings expected among the CITED (verified-conclusion) sources. */
  expectedCentralCitations: string[];
  /** True when this question is a named regression from live human testing — always run
   * multiple times (never cherry-picked) per Phase 15. */
  isNamedRegression: boolean;
  note: string;
}

export const LEGAL_ANSWER_EVAL_QUESTIONS: LegalAnswerEvalQuestion[] = [
  {
    id: "reg-1-blood-donor",
    category: "A_direct_substantive_right",
    query: "Kto może oddać krew w Polsce i jakie warunki musi spełnić dawca?",
    expectedStatus: "answered",
    expectedCentralCitations: [],
    isNamedRegression: true,
    note: "Named regression #1 — eligibility/conditions over donor-type definition.",
  },
  {
    id: "reg-2-soltys",
    category: "F_procedural_conditions",
    query: "Komu przysługuje świadczenie pieniężne z tytułu pełnienia funkcji sołtysa i jakie warunki trzeba spełnić?",
    expectedStatus: "answered",
    expectedCentralCitations: [],
    isNamedRegression: true,
    note: "Named regression #2 — 7-year + age 60/65 conditions must be the substance of the answer.",
  },
  {
    id: "reg-3-database-rights",
    category: "A_direct_substantive_right",
    query: "Jakie prawa przysługują producentowi bazy danych i przed czym chroni go ustawa?",
    expectedStatus: "answered",
    expectedCentralCitations: ["art. 6"],
    isNamedRegression: true,
    note: "Named regression #3 — the original defect: art. 6 ust. 1 dropped by packing before this milestone.",
  },
  {
    id: "db-remedies",
    category: "C_remedies",
    query: "Jakie roszczenia przysługują producentowi bazy danych w razie naruszenia jego praw?",
    expectedStatus: "answered",
    expectedCentralCitations: ["art. 11"],
    isNamedRegression: false,
    note: "Should reach art. 11 ust. 1 (zaniechanie/usunięcie skutków/naprawienie szkody/wydanie korzyści), not just the definition.",
  },
  {
    id: "db-duration",
    category: "B_multi_condition",
    query: "Jak długo trwa ochrona bazy danych i kiedy ten okres liczy się od nowa?",
    expectedStatus: "answered",
    expectedCentralCitations: ["art. 10"],
    isNamedRegression: false,
    note: "Two-part: base 15-year term AND the restart-on-substantial-change condition (art. 10 ust. 1 and ust. 3).",
  },
  {
    id: "db-definition",
    category: "D_definitions",
    query: "Kto jest producentem bazy danych w rozumieniu ustawy?",
    expectedStatus: "answered",
    expectedCentralCitations: ["art. 2"],
    isNamedRegression: false,
    note: "A genuinely definition-seeking question — art. 2 pkt 4 SHOULD be the answer here, unlike reg-3.",
  },
  {
    id: "db-exceptions",
    category: "E_exclusions",
    query: "Czy wolno korzystać z bazy danych do własnego użytku osobistego bez zgody producenta?",
    expectedStatus: "answered",
    expectedCentralCitations: ["art. 8"],
    isNamedRegression: false,
    note: "Permitted-use exception, not the general exclusive right.",
  },
  {
    id: "db-exact-citation",
    category: "H_exact_citation",
    query: "art. 6 ust. 1 ustawy o ochronie baz danych",
    expectedStatus: "answered",
    expectedCentralCitations: ["art. 6 ust. 1"],
    isNamedRegression: false,
    note: "Exact-citation retrieval must still short-circuit straight to the named provision.",
  },
  {
    id: "non-legal-poem",
    category: "I_unrelated_non_legal",
    query: "Napisz krótką rymowankę o pogodzie.",
    expectedStatus: "insufficient_evidence",
    expectedCentralCitations: [],
    isNamedRegression: false,
    note: "Zero legal issues expected; must never fabricate a legal answer.",
  },
  {
    id: "non-legal-arithmetic",
    category: "I_unrelated_non_legal",
    query: "Ile to jest 17 razy 23?",
    expectedStatus: "insufficient_evidence",
    expectedCentralCitations: [],
    isNamedRegression: false,
    note: "Zero legal issues expected.",
  },
  {
    id: "outside-corpus-kc",
    category: "J_outside_corpus_scope",
    query: "Jakie są przesłanki odpowiedzialności odszkodowawczej za czyn niedozwolony według Kodeksu cywilnego?",
    expectedStatus: "insufficient_evidence",
    expectedCentralCitations: [],
    isNamedRegression: false,
    note: "KC is not in the 5-act corpus (excluded, no structured current TJ) — must fail safely, never fabricate from an excluded/historical act.",
  },
  {
    id: "outside-corpus-kk",
    category: "J_outside_corpus_scope",
    query: "Jaka jest kara za kradzież według Kodeksu karnego?",
    expectedStatus: "insufficient_evidence",
    expectedCentralCitations: [],
    isNamedRegression: false,
    note: "KK is excluded from the pinned corpus — must fail safely.",
  },
  {
    id: "soltys-multi-part",
    category: "G_multi_part",
    query: "Czy świadczenie sołtysa przysługuje osobie, która pełniła funkcję krócej niż rok, i jaka jest wysokość świadczenia?",
    expectedStatus: "answered",
    expectedCentralCitations: [],
    isNamedRegression: false,
    note: "Multi-part: one sub-question likely unsupported/negative, the other (amount) supported — coverage must reflect both honestly.",
  },
];
