import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema";
import type { EmbedTextsFn } from "../search/embeddings";
import { type DetectLegalIssuesFn, type DetectLegalIssuesOptions } from "../issues/detect";
import { investigateLegalProblem } from "../issues/investigate";
import { generateFinalAnswer, type GenerateFinalAnswerFn, type GenerateFinalAnswerOptions } from "./generate";
import { packSources, type PackedSource } from "./packing";
import type { FinalAnswerConclusion, FinalAnswerSourceReference } from "./schema";
import {
  verifyConclusionSupport,
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
  detectIssues?: DetectLegalIssuesFn;
  detectIssuesOptions?: DetectLegalIssuesOptions;
  generateFinalAnswer?: GenerateFinalAnswerFn;
  generateFinalAnswerOptions?: GenerateFinalAnswerOptions;
  verifyConclusionSupport?: VerifyConclusionSupportFn;
  verifyConclusionSupportOptions?: VerifyConclusionSupportOptions;
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
  sourceExpressionId: string;
}

export interface ResolvedConclusion {
  statement: string;
  support: ResolvedSourceReference[];
}

export interface ResolvedAlternativePath {
  issueLabel: string;
  explanation: string;
  support: ResolvedSourceReference[];
}

export type LegalAnswerStatus = "answered" | "insufficient_evidence";

export interface LegalAnswerResult {
  status: LegalAnswerStatus;
  problemDescription: string;
  legalActVersionIds: string[];
  answer: string;
  conclusions: ResolvedConclusion[];
  alternativePaths: ResolvedAlternativePath[];
  uncertainties: string[];
  clarificationQuestion: string | null;
  /** Every source actually supplied to the model — the full evidence boundary, for transparency. */
  sources: PackedSource[];
}

const INSUFFICIENT_EVIDENCE_ANSWER =
  "Dostępne źródła w przeszukanym korpusie nie zawierają przepisów wystarczających, aby odpowiedzieć na to pytanie. Nie można wskazać podstawy prawnej bez odpowiednich przepisów w tym korpusie.";

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
      conclusions: [],
      alternativePaths: investigation.issues.map((issue) => ({
        issueLabel: issue.label,
        explanation: `Brak przepisów w przeszukanym korpusie potwierdzających lub wykluczających tę hipotezę (uzasadnienie hipotezy sformułowanej przed wyszukiwaniem: ${issue.rationale}).`,
        support: [],
      })),
      uncertainties: ["Wyszukiwanie nie zwróciło żadnych pasujących przepisów w tym korpusie dla tego zapytania."],
      clarificationQuestion: investigation.clarificationQuestion,
      sources: [],
    };
  }

  const packedSources = packSources(investigation.retrievedProvisions, { maxSources: options.maxSources });
  const packedBySourceId = new Map(packedSources.map((source) => [source.sourceId, source]));

  const generate = options.generateFinalAnswer ?? generateFinalAnswer;
  const raw = await generate(
    {
      problemDescription: investigation.problemDescription,
      issues: investigation.issues.map((issue) => ({
        label: issue.label,
        likelihood: issue.likelihood,
        rationale: issue.rationale,
      })),
      sources: packedSources,
    },
    options.generateFinalAnswerOptions,
  );

  const draftAlternativePaths = raw.alternativePaths.map((path) => ({
    issueLabel: path.issueLabel,
    explanation: path.explanation,
    support: resolveSupport(path.support, packedBySourceId),
  }));

  const { verifiedConclusions, demotedAlternativePaths } = await verifyDraftConclusions(
    investigation.problemDescription,
    raw.conclusions,
    packedBySourceId,
    options,
  );

  const alternativePaths = [...draftAlternativePaths, ...demotedAlternativePaths];

  if (verifiedConclusions.length === 0) {
    return {
      status: "insufficient_evidence",
      problemDescription: investigation.problemDescription,
      legalActVersionIds: investigation.legalActVersionIds,
      answer: INSUFFICIENT_EVIDENCE_AFTER_VERIFICATION_ANSWER,
      conclusions: [],
      alternativePaths,
      uncertainties: [
        ...raw.uncertainties,
        ...buildAuthorityCurrentnessCaveats([], alternativePaths),
      ],
      clarificationQuestion: raw.clarificationQuestion ?? investigation.clarificationQuestion,
      sources: packedSources,
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
    answer: buildDeterministicAnswerText(verifiedConclusions, draftAlternativePaths, uncertainties, clarificationQuestion),
    conclusions: verifiedConclusions,
    alternativePaths,
    uncertainties,
    clarificationQuestion,
    sources: packedSources,
  };
}

/**
 * Builds the user-facing answer prose entirely from verified, structured data — no OpenAI
 * call. This is what makes the fail-closed guarantee airtight for the prose, not just the
 * structured `conclusions` array: a rejected claim can never leak into the final answer text
 * because the text is never generated by (or copied from) the model after verification runs.
 */
function buildDeterministicAnswerText(
  conclusions: ResolvedConclusion[],
  alternativePaths: ResolvedAlternativePath[],
  uncertainties: string[],
  clarificationQuestion: string | null,
): string {
  const sections: string[] = ["Na podstawie przeszukanych i zweryfikowanych przepisów można wskazać następujące ustalenia:"];

  for (const conclusion of conclusions) {
    const citations = conclusion.support.map((source) => source.citationLabel).join(", ");
    sections.push(citations.length > 0 ? `${conclusion.statement} (${citations})` : conclusion.statement);
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
 * property-tort conclusion). This stage verifies each draft conclusion against ONLY the
 * source text the generator itself claimed as support — never other retrieved sources as
 * rescuing "alternative evidence" — and fails closed: a conclusion that does not pass
 * verification is never returned as a verified conclusion, only ever as an unsupported
 * alternative path with empty support.
 */
async function verifyDraftConclusions(
  problemDescription: string,
  draftConclusions: FinalAnswerConclusion[],
  packedBySourceId: Map<string, PackedSource>,
  options: AnswerLegalProblemOptions,
): Promise<{ verifiedConclusions: ResolvedConclusion[]; demotedAlternativePaths: ResolvedAlternativePath[] }> {
  if (draftConclusions.length === 0) {
    return { verifiedConclusions: [], demotedAlternativePaths: [] };
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
  const verificationResults = await verify(
    { problemDescription, conclusions: conclusionsToVerify },
    options.verifyConclusionSupportOptions,
  );

  const resultByIndex = new Map<number, RawConclusionVerificationResult>();
  for (const result of verificationResults) {
    resultByIndex.set(result.conclusionIndex, result);
  }

  const verifiedConclusions: ResolvedConclusion[] = [];
  const demotedAlternativePaths: ResolvedAlternativePath[] = [];

  draftConclusions.forEach((conclusion, conclusionIndex) => {
    const claimedSourceIds = new Set(conclusion.support.map((ref) => ref.sourceId));
    const verification = resultByIndex.get(conclusionIndex);

    if (!verification) {
      // Defense in depth against a misbehaving injected verifier: the default
      // implementation's Zod schema already guarantees exactly one result per index.
      throw new LegalAnswerError(
        `Verifier returned no result for conclusionIndex ${conclusionIndex} — refusing to treat an unverified conclusion as supported`,
      );
    }

    for (const sourceId of verification.supportingSourceIds) {
      if (!claimedSourceIds.has(sourceId)) {
        throw new LegalAnswerError(
          `Verifier referenced source "${sourceId}" that was not among the sources claimed by conclusion ${conclusionIndex} — refusing to fabricate support`,
        );
      }
    }

    if (verification.supported && verification.supportingSourceIds.length > 0) {
      verifiedConclusions.push({
        statement: conclusion.statement,
        support: resolveSupport(
          verification.supportingSourceIds.map((sourceId) => ({ sourceId })),
          packedBySourceId,
        ),
      });
      return;
    }

    demotedAlternativePaths.push({
      issueLabel: conclusion.statement,
      explanation: `Weryfikacja merytoryczna nie potwierdziła tego twierdzenia dostarczonymi źródłami: ${verification.reason}`,
      support: [],
    });
  });

  return { verifiedConclusions, demotedAlternativePaths };
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

  if (citedSources.some((source) => source.currentnessStatus !== "proven_current")) {
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
