import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema";
import type { EmbedTextsFn } from "../search/embeddings";
import { type DetectLegalIssuesFn, type DetectLegalIssuesOptions } from "../issues/detect";
import { investigateLegalProblem, type AnswerTargetView, type LegalIssueInvestigationIssue } from "../issues/investigate";
import { validateEvidenceAgainstSources } from "./evidence";
import { FinalAnswerGenerationError, generateFinalAnswer, type GenerateFinalAnswerFn, type GenerateFinalAnswerOptions } from "./generate";
import { packSources, type CurrentCorpusPackingContext, type PackedSource } from "./packing";
import {
  generateRecoveryConclusions,
  RecoveryGenerationError,
  type GenerateRecoveryConclusionsFn,
  type GenerateRecoveryConclusionsOptions,
} from "./recovery";
import type { RawRecoveryResponse, RecoveryConclusion } from "./recovery-schema";
import type { FinalAnswerConclusion, FinalAnswerSourceReference, RawFinalAnswerResponse } from "./schema";
import {
  runSkepticalVerification,
  type ConclusionForSkepticReview,
  type RunSkepticalVerificationFn,
  type RunSkepticalVerificationOptions,
} from "./skeptic";
import type { SkepticResult } from "./skeptic-schema";
import {
  verifyConclusionSupport,
  type ConclusionSourceForVerification,
  type VerifyConclusionSupportFn,
  type VerifyConclusionSupportOptions,
} from "./verify";
import type { RawConclusionVerificationResult } from "./verify-schema";

export class LegalAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegalAnswerError";
  }
}

export interface AnswerLegalProblemOptions {
  problemDescription: string;
  legalActVersionIds: string[];
  limitPerQuery?: number;
  maxSources?: number;
  db?: PostgresJsDatabase<typeof schema>;
  embedTexts?: EmbedTextsFn;
  minVectorSimilarity?: number;
  /**
   * Set ONLY when Explorer resolved a CURRENT-mode corpus for this exact query (see
   * src/lib/explorer/corpus-config.ts's resolveCurrentCorpus / run-query.ts) — every id in
   * `legalActVersionIds` here is, by construction of Model A (select.ts), an
   * `authoritative_current` entry of that one pinned run. Sources whose legalActVersionId is
   * in this set are presented as current AS OF `effectiveAsOf`, without ever mutating
   * legal_act_versions.currentnessStatus (which stays "unproven" forever — currentness is a
   * corpus-run-relative fact, not an immutable-version property). Omitted entirely in
   * historical/test mode.
   */
  currentCorpusContext?: CurrentCorpusPackingContext;
  detectIssues?: DetectLegalIssuesFn;
  detectIssuesOptions?: DetectLegalIssuesOptions;
  generateFinalAnswer?: GenerateFinalAnswerFn;
  generateFinalAnswerOptions?: GenerateFinalAnswerOptions;
  verifyConclusionSupport?: VerifyConclusionSupportFn;
  verifyConclusionSupportOptions?: VerifyConclusionSupportOptions;
  runSkepticalVerification?: RunSkepticalVerificationFn;
  runSkepticalVerificationOptions?: RunSkepticalVerificationOptions;
  generateRecoveryConclusions?: GenerateRecoveryConclusionsFn;
  generateRecoveryConclusionsOptions?: GenerateRecoveryConclusionsOptions;
  /**
   * Phase 13 (internal developer explainability): when true, `LegalAnswerResult.trace` is
   * populated from data this function already computes — no new OpenAI calls, no persistence,
   * disabled by default. See `LegalAnswerTrace` and src/scripts/trace-legal-answer.ts.
   */
  collectTrace?: boolean;
}

/** Full source metadata resolved back from a SOURCE_X reference — never just a bare id. */
export interface ResolvedSourceReference {
  legalProvisionId: string;
  legalActVersionId: string;
  legalActId: string;
  actTitle: string;
  citationLabel: string;
  versionKind: string;
  authorityClass: string;
  currentnessStatus: string;
  /** See PackedSource.provenCurrentAsOf — propagated unchanged through verification. */
  provenCurrentAsOf: string | null;
  sourceExpressionId: string;
}

export interface ResolvedConclusion {
  statement: string;
  support: ResolvedSourceReference[];
  /** 1-based index into `answerTargets`, or null for a general claim not tied to one specific
   * requested aspect (Phase 10). Opaque metadata carried through from the generator/recovery —
   * verify.ts/skeptic.ts never read or gate on it. */
  answerTargetIndex: number | null;
}

export interface ResolvedAlternativePath {
  issueLabel: string;
  explanation: string;
  support: ResolvedSourceReference[];
}

export type LegalAnswerStatus = "answered" | "insufficient_evidence";

export type AnswerTargetCoverageStatus = "verified" | "unsupported";

/**
 * Deterministic, post-verification coverage assessment (Phase 11) — never invents a claim, only
 * reports what actually survived. A target is "verified" iff at least one verified conclusion
 * carries its index; otherwise "unsupported", regardless of how much peripheral evidence exists.
 */
export interface AnswerTargetCoverage extends AnswerTargetView {
  status: AnswerTargetCoverageStatus;
}

/**
 * Phase 13 debug trace — internal developer explainability only, assembled purely from data
 * this function already computes (no new OpenAI calls, no persistence). Undefined unless
 * `AnswerLegalProblemOptions.collectTrace` is true. Never wired into the Explorer UI/runtime.
 */
export interface LegalAnswerTrace {
  answerTargets: AnswerTargetView[];
  issues: LegalIssueInvestigationIssue[];
  retrievedProvisionCount: number;
  packedSources: PackedSource[];
  draftConclusions: FinalAnswerConclusion[];
  /** Set only when normal generation itself failed structurally (invalid/malformed model
   * output, refusal, non-stop finish_reason) — never for infra failures, which propagate as
   * thrown errors instead of reaching this trace at all. Null when generation succeeded. */
  generationStructuralFailureReason: string | null;
  rawVerifyResults: RawConclusionVerificationResult[];
  rawSkepticResults: SkepticResult[];
  recoveryRan: boolean;
  /** Set only when the recovery pass itself failed structurally (same distinction as
   * generationStructuralFailureReason). Null when recovery wasn't run, or ran and either
   * succeeded or failed only for an infra reason (still swallowed by design — see
   * runRecoveryPass — but not reported here as "structural"). */
  recoveryStructuralFailureReason: string | null;
  targetCoverage: AnswerTargetCoverage[];
}

export interface LegalAnswerResult {
  status: LegalAnswerStatus;
  problemDescription: string;
  legalActVersionIds: string[];
  answer: string;
  answerTargets: AnswerTargetView[];
  targetCoverage: AnswerTargetCoverage[];
  conclusions: ResolvedConclusion[];
  alternativePaths: ResolvedAlternativePath[];
  uncertainties: string[];
  clarificationQuestion: string | null;
  /** Every source actually supplied to the model — the full evidence boundary, for transparency. */
  sources: PackedSource[];
  /** See LegalAnswerTrace — present only when `collectTrace: true` was requested. */
  trace?: LegalAnswerTrace;
}

const INSUFFICIENT_EVIDENCE_ANSWER =
  "Dostępne źródła w przeszukanym korpusie nie zawierają przepisów wystarczających, aby odpowiedzieć na to pytanie. Nie można wskazać podstawy prawnej bez odpowiednich przepisów w tym korpusie.";

/**
 * Surfaced only when normal generation itself failed structurally (see the catch around the
 * `generate(...)` call in answerLegalProblem) — distinct from GENERATION rejecting a claim at
 * verification, which has its own message (INSUFFICIENT_EVIDENCE_AFTER_VERIFICATION_ANSWER).
 * Never shown for infra/config failures, which throw instead of reaching this constant.
 */
const GENERATION_STRUCTURAL_FAILURE_UNCERTAINTY =
  "Wygenerowanie wstępnej odpowiedzi nie powiodło się z przyczyn technicznych (nieprawidłowy format odpowiedzi modelu) — podjęto próbę odzyskania odpowiedzi wyłącznie na podstawie źródeł.";

function resolveSupport(
  support: FinalAnswerSourceReference[],
  packedBySourceId: Map<string, PackedSource>,
): ResolvedSourceReference[] {
  return support.map((ref) => {
    const source = packedBySourceId.get(ref.sourceId);
    if (!source) {
      // Unreachable in practice: generateFinalAnswer validates every sourceId against the
      // packed set before returning. Guarded here so a broken injected fake fails loudly
      // instead of silently fabricating a citation.
      throw new LegalAnswerError(
        `Unknown source reference "${ref.sourceId}" survived validation — refusing to fabricate a citation`,
      );
    }

    return {
      legalProvisionId: source.legalProvisionId,
      legalActVersionId: source.legalActVersionId,
      legalActId: source.legalActId,
      actTitle: source.actTitle,
      citationLabel: source.citationLabel,
      versionKind: source.versionKind,
      authorityClass: source.authorityClass,
      currentnessStatus: source.currentnessStatus,
      provenCurrentAsOf: source.provenCurrentAsOf,
      sourceExpressionId: source.sourceExpressionId,
    };
  });
}

/**
 * USER PROBLEM -> issue detection -> retrieval queries -> hybrid search ->
 * verified retrieved provisions -> grounded final answer.
 *
 * legalActVersionIds is required and non-empty (enforced by investigateLegalProblem,
 * which this reuses unmodified) — there is no global current-law corpus fallback here
 * or anywhere upstream. When retrieval finds zero provisions, the final-answer model is
 * never called; a deterministic insufficient-evidence result is returned instead.
 */
export async function answerLegalProblem(options: AnswerLegalProblemOptions): Promise<LegalAnswerResult> {
  const investigation = await investigateLegalProblem({
    problemDescription: options.problemDescription,
    legalActVersionIds: options.legalActVersionIds,
    limitPerQuery: options.limitPerQuery,
    db: options.db,
    embedTexts: options.embedTexts,
    minVectorSimilarity: options.minVectorSimilarity,
    detectIssues: options.detectIssues,
    detectIssuesOptions: options.detectIssuesOptions,
  });

  if (investigation.retrievedProvisions.length === 0) {
    return {
      status: "insufficient_evidence",
      problemDescription: investigation.problemDescription,
      legalActVersionIds: investigation.legalActVersionIds,
      answer: INSUFFICIENT_EVIDENCE_ANSWER,
      answerTargets: investigation.answerTargets,
      targetCoverage: investigation.answerTargets.map((target) => ({ ...target, status: "unsupported" as const })),
      conclusions: [],
      alternativePaths: investigation.issues.map((issue) => ({
        issueLabel: issue.label,
        explanation: `Brak przepisów w przeszukanym korpusie potwierdzających lub wykluczających tę hipotezę (uzasadnienie hipotezy sformułowanej przed wyszukiwaniem: ${issue.rationale}).`,
        support: [],
      })),
      uncertainties: ["Wyszukiwanie nie zwróciło żadnych pasujących przepisów w tym korpusie dla tego zapytania."],
      clarificationQuestion: investigation.clarificationQuestion,
      sources: [],
      trace: options.collectTrace
        ? {
            answerTargets: investigation.answerTargets,
            issues: investigation.issues,
            retrievedProvisionCount: 0,
            packedSources: [],
            draftConclusions: [],
            generationStructuralFailureReason: null,
            rawVerifyResults: [],
            rawSkepticResults: [],
            recoveryRan: false,
            recoveryStructuralFailureReason: null,
            targetCoverage: investigation.answerTargets.map((target) => ({ ...target, status: "unsupported" as const })),
          }
        : undefined,
    };
  }

  const packedSources = packSources(investigation.retrievedProvisions, {
    maxSources: options.maxSources,
    answerTargets: investigation.answerTargets,
    currentCorpusContext: options.currentCorpusContext,
  });
  const packedBySourceId = new Map(packedSources.map((source) => [source.sourceId, source]));

  const generate = options.generateFinalAnswer ?? generateFinalAnswer;
  let raw: RawFinalAnswerResponse;
  let generationStructuralFailureReason: string | null = null;
  try {
    raw = await generate(
      {
        problemDescription: investigation.problemDescription,
        issues: investigation.issues.map((issue) => ({
          label: issue.label,
          likelihood: issue.likelihood,
          rationale: issue.rationale,
        })),
        sources: packedSources,
        answerTargets: investigation.answerTargets,
      },
      options.generateFinalAnswerOptions,
    );
  } catch (error) {
    if (error instanceof FinalAnswerGenerationError && error.code === "INVALID_RESPONSE") {
      // Fail closed, not fail loud: the model produced a structurally invalid response (or
      // explicitly refused) rather than a safely groundable one — e.g. a conclusion with empty
      // `support` violates the schema and is correctly rejected rather than silently accepted.
      // This is NEVER treated as "no legal basis exists"; it degenerates into an empty draft,
      // which flows through the exact same verify/recovery machinery as a real zero-conclusion
      // draft (recovery still gets a fair, independent shot at the same packed sources below).
      // CONFIG/HTTP_ERROR/TIMEOUT are infrastructure/configuration failures, not answer-validity
      // failures, and are deliberately NOT caught here — they propagate as thrown errors so a
      // genuine outage is never silently mistaken for "insufficient evidence."
      generationStructuralFailureReason = error.message;
      raw = {
        answer: "",
        conclusions: [],
        alternativePaths: [],
        uncertainties: [GENERATION_STRUCTURAL_FAILURE_UNCERTAINTY],
        clarificationQuestion: undefined,
      };
    } else {
      throw error;
    }
  }

  const draftAlternativePaths = raw.alternativePaths.map((path) => ({
    issueLabel: path.issueLabel,
    explanation: path.explanation,
    support: resolveSupport(path.support, packedBySourceId),
  }));

  const firstPass = await verifyDraftConclusions(
    investigation.problemDescription,
    raw.conclusions,
    packedBySourceId,
    options,
  );

  let verifiedConclusions = firstPass.verifiedConclusions;
  let demotedAlternativePaths = firstPass.demotedAlternativePaths;
  let recoveryRan = false;
  let recoveryStructuralFailureReason: string | null = null;
  let rawVerifyResults = firstPass.rawVerifyResults;
  let rawSkepticResults = firstPass.rawSkepticResults;

  // Bounded, single source-first recovery pass: only when usable retrieval evidence exists
  // (guaranteed at this point — the zero-provisions case already returned above) AND the
  // normal generate -> verify -> skeptic pipeline produced zero verified conclusions (this
  // includes the case where generation itself failed structurally, above — recovery still
  // gets an independent shot at the same packed sources). Never runs when at least one
  // conclusion already survived, and never loops or retries beyond this single call. See
  // recovery.ts and runRecoveryPass for why this cannot rescue a rejected claim — it rebuilds
  // from source text alone and is re-verified through the exact same gates as the first pass.
  if (verifiedConclusions.length === 0) {
    recoveryRan = true;
    const recoveryPass = await runRecoveryPass(
      investigation.problemDescription,
      packedSources,
      packedBySourceId,
      investigation.answerTargets,
      options,
    );
    verifiedConclusions = recoveryPass.verifiedConclusions;
    demotedAlternativePaths = [...demotedAlternativePaths, ...recoveryPass.demotedAlternativePaths];
    rawVerifyResults = [...rawVerifyResults, ...recoveryPass.rawVerifyResults];
    rawSkepticResults = [...rawSkepticResults, ...recoveryPass.rawSkepticResults];
    recoveryStructuralFailureReason = recoveryPass.structuralFailureReason;
  }

  const alternativePaths = [...draftAlternativePaths, ...demotedAlternativePaths];
  const targetCoverage = computeTargetCoverage(investigation.answerTargets, verifiedConclusions);

  const trace: LegalAnswerTrace | undefined = options.collectTrace
    ? {
        answerTargets: investigation.answerTargets,
        issues: investigation.issues,
        retrievedProvisionCount: investigation.retrievedProvisions.length,
        packedSources,
        draftConclusions: raw.conclusions,
        generationStructuralFailureReason,
        rawVerifyResults,
        rawSkepticResults,
        recoveryRan,
        recoveryStructuralFailureReason,
        targetCoverage,
      }
    : undefined;

  if (verifiedConclusions.length === 0) {
    return {
      status: "insufficient_evidence",
      problemDescription: investigation.problemDescription,
      legalActVersionIds: investigation.legalActVersionIds,
      answer: INSUFFICIENT_EVIDENCE_AFTER_VERIFICATION_ANSWER,
      answerTargets: investigation.answerTargets,
      targetCoverage,
      conclusions: [],
      alternativePaths,
      uncertainties: [
        ...raw.uncertainties,
        ...buildAuthorityCurrentnessCaveats([], alternativePaths),
      ],
      clarificationQuestion: raw.clarificationQuestion ?? investigation.clarificationQuestion,
      sources: packedSources,
      trace,
    };
  }

  const uncertainties = [...raw.uncertainties, ...buildAuthorityCurrentnessCaveats(verifiedConclusions, alternativePaths)];
  const clarificationQuestion = raw.clarificationQuestion ?? investigation.clarificationQuestion;

  return {
    status: "answered",
    problemDescription: investigation.problemDescription,
    legalActVersionIds: investigation.legalActVersionIds,
    // Deterministically rebuilt from verified data ONLY — the pre-verification draft prose
    // (raw.answer) is never surfaced, because it may narrate a claim the verifier rejected
    // even though that claim no longer appears in `conclusions`. Note: only the model's own
    // genuine draftAlternativePaths are rendered into prose, never demotedAlternativePaths —
    // a demoted item's `issueLabel` is the verbatim rejected claim, and restating it as an
    // "other possible issue" in the user-facing text would reopen exactly the leak this fixes.
    answer: buildDeterministicAnswerText(
      investigation.answerTargets,
      targetCoverage,
      verifiedConclusions,
      draftAlternativePaths,
      uncertainties,
      clarificationQuestion,
    ),
    answerTargets: investigation.answerTargets,
    targetCoverage,
    conclusions: verifiedConclusions,
    alternativePaths,
    uncertainties,
    clarificationQuestion,
    sources: packedSources,
    trace,
  };
}

/**
 * Deterministic, post-verification coverage assessment (Phase 11). Never invents a claim —
 * "verified" requires an actual verified conclusion carrying that target's index; everything
 * else (including a target with only demoted/unsupported draft claims) is "unsupported".
 */
function computeTargetCoverage(
  answerTargets: AnswerTargetView[],
  verifiedConclusions: ResolvedConclusion[],
): AnswerTargetCoverage[] {
  const verifiedTargetIndexes = new Set(
    verifiedConclusions.map((c) => c.answerTargetIndex).filter((index): index is number => index !== null),
  );
  return answerTargets.map((target) => ({
    ...target,
    status: verifiedTargetIndexes.has(target.index) ? "verified" : "unsupported",
  }));
}

/**
 * Builds the user-facing answer prose entirely from verified, structured data — no OpenAI
 * call. This is what makes the fail-closed guarantee airtight for the prose, not just the
 * structured `conclusions` array: a rejected claim can never leak into the final answer text
 * because the text is never generated by (or copied from) the model after verification runs.
 *
 * Phase 9-11 relevance discipline: conclusions are reordered so verified answers to the user's
 * own answerTargets lead, IN TARGET ORDER — a peripheral, untagged-but-verified claim (e.g. a
 * definition that happened to be easy to verify) can never crowd out or precede a direct answer
 * to what was actually asked. Any answerTarget left unsupported gets an explicit, honest note
 * instead of being silently omitted or papered over with peripheral content.
 */
function buildDeterministicAnswerText(
  answerTargets: AnswerTargetView[],
  targetCoverage: AnswerTargetCoverage[],
  conclusions: ResolvedConclusion[],
  alternativePaths: ResolvedAlternativePath[],
  uncertainties: string[],
  clarificationQuestion: string | null,
): string {
  const sections: string[] = ["Na podstawie przeszukanych i zweryfikowanych przepisów można wskazać następujące ustalenia:"];

  const conclusionsByTargetIndex = new Map<number, ResolvedConclusion[]>();
  const untaggedConclusions: ResolvedConclusion[] = [];
  for (const conclusion of conclusions) {
    if (conclusion.answerTargetIndex === null) {
      untaggedConclusions.push(conclusion);
      continue;
    }
    const bucket = conclusionsByTargetIndex.get(conclusion.answerTargetIndex) ?? [];
    bucket.push(conclusion);
    conclusionsByTargetIndex.set(conclusion.answerTargetIndex, bucket);
  }

  const orderedConclusions: ResolvedConclusion[] = [
    ...answerTargets.flatMap((target) => conclusionsByTargetIndex.get(target.index) ?? []),
    ...untaggedConclusions,
  ];

  for (const conclusion of orderedConclusions) {
    const citations = conclusion.support.map((source) => source.citationLabel).join(", ");
    sections.push(citations.length > 0 ? `${conclusion.statement} (${citations})` : conclusion.statement);
  }

  const unsupportedTargets = targetCoverage.filter((target) => target.status === "unsupported");
  if (unsupportedTargets.length > 0) {
    const items = unsupportedTargets.map((target) => `- ${target.text}`).join("\n");
    sections.push(
      `Następujących aspektów pytania nie udało się potwierdzić dostarczonymi, zweryfikowanymi przepisami:\n${items}`,
    );
  }

  const unsupportedPaths = alternativePaths.filter((path) => path.explanation.length > 0);
  if (unsupportedPaths.length > 0) {
    const items = unsupportedPaths
      .map((path) => {
        const citations = path.support.map((source) => source.citationLabel).join(", ");
        const suffix = citations.length > 0 ? ` (${citations})` : "";
        return `- ${path.issueLabel}: ${path.explanation}${suffix}`;
      })
      .join("\n");
    sections.push(`Możliwe inne kwestie (niepotwierdzone dostarczonymi przepisami):\n${items}`);
  }

  if (uncertainties.length > 0) {
    sections.push(`Niepewności:\n${uncertainties.map((entry) => `- ${entry}`).join("\n")}`);
  }

  if (clarificationQuestion) {
    sections.push(`Dodatkowe pytanie: ${clarificationQuestion}`);
  }

  return sections.join("\n\n");
}

/**
 * A valid SOURCE_X citation is necessary but not sufficient: the generator can cite a real,
 * validly-supplied source and still misapply it to a claim its text does not substantively
 * support (observed live: a real KPA procedural provision cited to support an unrelated
 * property-tort conclusion). A conclusion survives only after passing ALL of:
 *
 *   1. stage 1 (verify.ts): strict tri-state verdict — only "direct_support" continues,
 *      never "partial_support" (no hedging upward) or "no_support";
 *   2. code-level validation (evidence.ts): every excerpt the model claims as evidence must
 *      occur verbatim (whitespace-normalized only, no fuzzy matching) in the exact source
 *      text the generator itself claimed as support for that conclusion — never other
 *      retrieved sources as rescuing "alternative evidence";
 *   3. stage 2 (skeptic.ts): a separate, adversarially-framed pass over only the stage-1
 *      survivors, which must find no unsupported legal leap (scope expansion, domain
 *      mismatch, procedural/substantive confusion, etc.).
 *
 * Any failure at any stage fails closed: the conclusion is never returned as verified, only
 * ever as a demoted, unsupported alternative path with empty support.
 */
interface VerifyDraftConclusionsResult {
  verifiedConclusions: ResolvedConclusion[];
  demotedAlternativePaths: ResolvedAlternativePath[];
  /** Raw stage-1/stage-2 model outputs, for the Phase 13 debug trace only. */
  rawVerifyResults: RawConclusionVerificationResult[];
  rawSkepticResults: SkepticResult[];
}

async function verifyDraftConclusions(
  problemDescription: string,
  draftConclusions: FinalAnswerConclusion[],
  packedBySourceId: Map<string, PackedSource>,
  options: AnswerLegalProblemOptions,
): Promise<VerifyDraftConclusionsResult> {
  if (draftConclusions.length === 0) {
    return { verifiedConclusions: [], demotedAlternativePaths: [], rawVerifyResults: [], rawSkepticResults: [] };
  }

  const conclusionsToVerify = draftConclusions.map((conclusion, conclusionIndex) => ({
    conclusionIndex,
    statement: conclusion.statement,
    sources: conclusion.support.map((ref) => {
      const source = getPackedSource(ref.sourceId, packedBySourceId);
      return { sourceId: source.sourceId, citationLabel: source.citationLabel, text: source.text };
    }),
  }));

  const verify = options.verifyConclusionSupport ?? verifyConclusionSupport;
  const strictResults = await verify(
    { problemDescription, conclusions: conclusionsToVerify },
    options.verifyConclusionSupportOptions,
  );

  const strictByIndex = new Map<number, RawConclusionVerificationResult>();
  for (const result of strictResults) {
    strictByIndex.set(result.conclusionIndex, result);
  }

  const demotedAlternativePaths: ResolvedAlternativePath[] = [];
  const strictPassed: {
    conclusionIndex: number;
    conclusion: FinalAnswerConclusion;
    sources: ConclusionSourceForVerification[];
    confirmedExcerpts: { sourceId: string; excerpt: string }[];
  }[] = [];

  draftConclusions.forEach((conclusion, conclusionIndex) => {
    const claimedSourceIds = new Set(conclusion.support.map((ref) => ref.sourceId));
    const strict = strictByIndex.get(conclusionIndex);

    if (!strict) {
      // Defense in depth against a misbehaving injected verifier: the default
      // implementation's Zod schema already guarantees exactly one result per index.
      throw new LegalAnswerError(
        `Verifier returned no result for conclusionIndex ${conclusionIndex} — refusing to treat an unverified conclusion as supported`,
      );
    }

    for (const evidenceItem of strict.evidence) {
      if (!claimedSourceIds.has(evidenceItem.sourceId)) {
        throw new LegalAnswerError(
          `Verifier referenced source "${evidenceItem.sourceId}" that was not among the sources claimed by conclusion ${conclusionIndex} — refusing to fabricate support`,
        );
      }
    }

    if (strict.verdict !== "direct_support") {
      demotedAlternativePaths.push({
        issueLabel: conclusion.statement,
        explanation: `Weryfikacja merytoryczna (etap 1) nie potwierdziła tego twierdzenia jako bezpośrednio wspartego dostarczonymi źródłami: ${strict.reason}`,
        support: [],
      });
      return;
    }

    const sourceTextById = new Map(
      conclusionsToVerify[conclusionIndex].sources.map((source) => [source.sourceId, source.text]),
    );
    const failures = validateEvidenceAgainstSources(strict.evidence, sourceTextById);

    if (failures.length > 0) {
      demotedAlternativePaths.push({
        issueLabel: conclusion.statement,
        explanation:
          "Zwrócone przez model fragmenty dowodowe nie zostały odnalezione dosłownie w tekście wskazanego źródła — twierdzenie odrzucono zgodnie z zasadą fail-closed, bez dalszej weryfikacji.",
        support: [],
      });
      return;
    }

    strictPassed.push({
      conclusionIndex,
      conclusion,
      sources: conclusionsToVerify[conclusionIndex].sources,
      confirmedExcerpts: strict.evidence.map((item) => ({ sourceId: item.sourceId, excerpt: item.excerpt })),
    });
  });

  if (strictPassed.length === 0) {
    return { verifiedConclusions: [], demotedAlternativePaths, rawVerifyResults: strictResults, rawSkepticResults: [] };
  }

  const skepticInput: ConclusionForSkepticReview[] = strictPassed.map((passed) => ({
    conclusionIndex: passed.conclusionIndex,
    statement: passed.conclusion.statement,
    sources: passed.sources,
    confirmedExcerpts: passed.confirmedExcerpts,
  }));

  const skeptic = options.runSkepticalVerification ?? runSkepticalVerification;
  const skepticResults = await skeptic(
    { problemDescription, conclusions: skepticInput },
    options.runSkepticalVerificationOptions,
  );

  const skepticByIndex = new Map<number, SkepticResult>();
  for (const result of skepticResults) {
    skepticByIndex.set(result.conclusionIndex, result);
  }

  const verifiedConclusions: ResolvedConclusion[] = [];

  for (const passed of strictPassed) {
    const skepticResult = skepticByIndex.get(passed.conclusionIndex);

    if (!skepticResult) {
      // Defense in depth: buildSkepticResponseSchema already guarantees exactly one
      // result per requested conclusionIndex against a misbehaving injected fake.
      throw new LegalAnswerError(
        `Skeptical verifier returned no result for conclusionIndex ${passed.conclusionIndex} — refusing to treat an unreviewed conclusion as verified`,
      );
    }

    if (skepticResult.hasUnsupportedLeap) {
      demotedAlternativePaths.push({
        issueLabel: passed.conclusion.statement,
        explanation: `Weryfikacja krytyczna (etap 2) wykryła nieuprawniony skok logiczny wykraczający poza potwierdzony dowód: ${skepticResult.reason}`,
        support: [],
      });
      continue;
    }

    const uniqueSourceIds = [...new Set(passed.confirmedExcerpts.map((item) => item.sourceId))];
    verifiedConclusions.push({
      statement: passed.conclusion.statement,
      support: resolveSupport(
        uniqueSourceIds.map((sourceId) => ({ sourceId })),
        packedBySourceId,
      ),
      answerTargetIndex: passed.conclusion.answerTargetIndex ?? null,
    });
  }

  return { verifiedConclusions, demotedAlternativePaths, rawVerifyResults: strictResults, rawSkepticResults: skepticResults };
}

/**
 * Deterministically drops any recovery conclusion whose self-claimed excerpt does not occur
 * verbatim in the source text it claims to come from — BEFORE that conclusion is even allowed
 * to reach the standard verifier. This is an extra gate specific to recovery, on top of (not
 * instead of) the identical stage-1/evidence/skeptic gates every conclusion — recovery or not
 * — must still pass afterward via verifyDraftConclusions. Reuses the exact same evidence.ts
 * mechanism as the standard pipeline (existing whitespace normalization only, no fuzzy match).
 */
function filterRecoveryConclusionsByOwnExcerpt(
  conclusions: RecoveryConclusion[],
  packedBySourceId: Map<string, PackedSource>,
): FinalAnswerConclusion[] {
  const survivors: FinalAnswerConclusion[] = [];

  for (const conclusion of conclusions) {
    const sourceTextById = new Map<string, string>();
    for (const item of conclusion.support) {
      const source = packedBySourceId.get(item.sourceId);
      if (source) {
        sourceTextById.set(item.sourceId, source.text);
      }
    }

    const failures = validateEvidenceAgainstSources(
      conclusion.support.map((item) => ({ sourceId: item.sourceId, excerpt: item.excerpt })),
      sourceTextById,
    );

    if (failures.length > 0) {
      continue;
    }

    survivors.push({
      statement: conclusion.statement,
      support: conclusion.support.map((item) => ({ sourceId: item.sourceId })),
      // Threaded through unchanged: recovery now receives the SAME answerTargets as normal
      // generation (see runRecoveryPass) and can tag its own conclusions the same way — this
      // is what makes computeTargetCoverage able to credit a recovery-sourced answer to the
      // target it actually addresses, instead of every recovery conclusion silently reading
      // as "unsupported" for every target regardless of relevance.
      answerTargetIndex: conclusion.answerTargetIndex ?? null,
    });
  }

  return survivors;
}

interface RecoveryPassResult extends VerifyDraftConclusionsResult {
  /** Set only when recovery generation itself failed structurally (invalid/malformed model
   * output, refusal, non-stop finish_reason, or an out-of-range answerTargetIndex rejected by
   * buildRawRecoveryResponseSchema) — never for infra failures (CONFIG/HTTP_ERROR/TIMEOUT),
   * which are still swallowed here (recovery remains a best-effort, non-fatal pass by design)
   * but are NOT reported as "structural" since they say nothing about answer validity. */
  structuralFailureReason: string | null;
}

/**
 * Runs the single, bounded source-first recovery pass (see recovery.ts for the generation
 * prompt/schema). Recovery conclusions receive NO privileged treatment: after the self-
 * excerpt gate above, survivors are funneled through the identical verifyDraftConclusions
 * used for the first pass — same strict verifier, same evidence validation, same skeptic.
 * `answerTargetIndex` tagging (see filterRecoveryConclusionsByOwnExcerpt) is likewise never
 * trusted by those gates — it only affects relevance/coverage assembly AFTER a claim has
 * independently survived them. A recovery-generation failure (network/timeout/malformed
 * output) is caught and logged here rather than thrown, so a recovery hiccup can never turn
 * what would otherwise have been a safe insufficient_evidence result into a hard error — it
 * just means recovery contributes nothing, and the caller's existing insufficient_evidence
 * fallback still applies. This is intentionally broader than the normal-generation fail-closed
 * boundary above: recovery is already a best-effort last resort, so ANY failure (not only
 * INVALID_RESPONSE) safely degenerates to "recovery contributes nothing" — never a thrown
 * error — while still distinguishing a structural (answer-validity) failure from an infra one
 * for logging/trace purposes only.
 */
async function runRecoveryPass(
  problemDescription: string,
  packedSources: PackedSource[],
  packedBySourceId: Map<string, PackedSource>,
  answerTargets: AnswerTargetView[],
  options: AnswerLegalProblemOptions,
): Promise<RecoveryPassResult> {
  const generateRecovery = options.generateRecoveryConclusions ?? generateRecoveryConclusions;

  let recoveryRaw: RawRecoveryResponse;
  try {
    recoveryRaw = await generateRecovery(
      { problemDescription, sources: packedSources, answerTargets },
      options.generateRecoveryConclusionsOptions,
    );
  } catch (error) {
    const structuralFailureReason =
      error instanceof RecoveryGenerationError && error.code === "INVALID_RESPONSE" ? error.message : null;
    console.error(
      "Recovery generation pass failed; falling back to the existing insufficient_evidence result:",
      error instanceof Error ? error.message : "unknown error",
    );
    return {
      verifiedConclusions: [],
      demotedAlternativePaths: [],
      rawVerifyResults: [],
      rawSkepticResults: [],
      structuralFailureReason,
    };
  }

  const survivors = filterRecoveryConclusionsByOwnExcerpt(recoveryRaw.conclusions, packedBySourceId);

  const verified = await verifyDraftConclusions(problemDescription, survivors, packedBySourceId, options);
  return { ...verified, structuralFailureReason: null };
}

function getPackedSource(sourceId: string, packedBySourceId: Map<string, PackedSource>): PackedSource {
  const source = packedBySourceId.get(sourceId);
  if (!source) {
    throw new LegalAnswerError(
      `Unknown source reference "${sourceId}" survived validation — refusing to fabricate a citation`,
    );
  }
  return source;
}

const INSUFFICIENT_EVIDENCE_AFTER_VERIFICATION_ANSWER =
  "Wygenerowana wstępna odpowiedź nie przeszła weryfikacji merytorycznej — żadne z wypracowanych twierdzeń nie zostało potwierdzone treścią dostarczonych przepisów. Nie można przedstawić potwierdzonej podstawy prawnej dla tego problemu w przeszukanym korpusie.";

/**
 * The model is only prompted to add authority/currentness caveats in its own prose — that's
 * a soft, probabilistic instruction. This adds a deterministic, code-level guarantee on top:
 * whenever a citation actually used in the answer is non-authoritative or currentness-unproven,
 * an explicit uncertainty entry is always present, regardless of what the model's text says.
 */
function buildAuthorityCurrentnessCaveats(
  conclusions: ResolvedConclusion[],
  alternativePaths: ResolvedAlternativePath[],
): string[] {
  const citedSources = [...conclusions, ...alternativePaths].flatMap((item) => item.support);

  const caveats: string[] = [];

  // A source counts as "confirmed current" only via provenCurrentAsOf — set exclusively when
  // this exact query resolved a CURRENT-mode corpus run and this source's version is one of
  // that run's authoritative_current entries (see PackedSource.provenCurrentAsOf). Checking
  // currentnessStatus itself would never do this, since it stays "unproven" everywhere by
  // design (see Model A / current-law-corpus milestone) — currentness is corpus-run-relative.
  if (citedSources.some((source) => source.provenCurrentAsOf === null)) {
    caveats.push(
      "Aktualność (obowiązywanie w obecnym stanie prawnym) cytowanych przepisów nie została potwierdzona przez system — nie należy zakładać, że są to przepisy obecnie obowiązujące bez dalszej weryfikacji.",
    );
  }

  if (citedSources.some((source) => source.authorityClass === "non_authoritative")) {
    caveats.push(
      "Część cytowanych źródeł ma charakter nieautorytatywny (np. tekst ujednolicony) i nie stanowi samodzielnie wiążącego prawa.",
    );
  }

  return caveats;
}
