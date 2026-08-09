import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { legalActVersions, legalActs, legalProvisions } from "../../../db/schema";
import { createTestDatabase } from "../../test-support/test-db";
import type { EmbedTextsFn } from "../search/embeddings";
import { indexLegalSearchDocuments } from "../search/indexing";
import type { DetectLegalIssuesFn } from "../issues/detect";
import { LegalIssueInvestigationError } from "../issues/investigate";
import type { LegalIssueDetectionResult } from "../issues/schema";
import { answerLegalProblem, LegalAnswerError } from "./answer";
import type { GenerateFinalAnswerFn, GenerateFinalAnswerInput } from "./generate";
import type { GenerateRecoveryConclusionsFn } from "./recovery";
import type { RawFinalAnswerResponse } from "./schema";
import type { RunSkepticalVerificationFn } from "./skeptic";
import type { VerifyConclusionSupportFn } from "./verify";

const testDatabase = createTestDatabase();
const describeDatabase = testDatabase ? describe : describe.skip;
const client = testDatabase?.client;
const db = testDatabase?.db;

const TEST_SOURCE = "test_answer_fixture";
const TEST_SOURCE_ID = "TEST/ANSWER/1";
const DIMENSIONS = 1536;

function basisVector(index: number): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  vector[index] = 1;
  return vector;
}

/** Deterministic fake embedding: buckets text by which marker keyword it contains. */
const fakeEmbed: EmbedTextsFn = async (texts) => {
  return texts.map((text) => {
    if (text.includes("KEYWORD_ALPHA")) return basisVector(0);
    if (text.includes("KEYWORD_BETA")) return basisVector(1);
    return basisVector(2);
  });
};

afterAll(async () => {
  await client?.end({ timeout: 1 });
});

describeDatabase("answerLegalProblem", () => {
  beforeEach(async () => {
    if (!db) return;
    await db.delete(legalActs).where(and(eq(legalActs.source, TEST_SOURCE), eq(legalActs.sourceId, TEST_SOURCE_ID)));
  });

  async function seedFixture() {
    if (!db) throw new Error("DATABASE_URL is required for integration test");

    const [act] = await db
      .insert(legalActs)
      .values({
        jurisdiction: "PL",
        source: TEST_SOURCE,
        sourceId: TEST_SOURCE_ID,
        title: "Ustawa testowa",
        actType: "ustawa",
      })
      .returning({ id: legalActs.id });

    const [currentVersion] = await db
      .insert(legalActVersions)
      .values({
        legalActId: act.id,
        versionKind: "promulgated",
        sourceExpressionId: "ogl",
        sourceDocumentKey: "test_answer_current",
        authorityClass: "authoritative",
        nonAuthoritative: false,
        currentnessStatus: "unproven",
      })
      .returning({ id: legalActVersions.id });

    const [nonAuthoritativeVersion] = await db
      .insert(legalActVersions)
      .values({
        legalActId: act.id,
        versionKind: "unified",
        sourceExpressionId: "uj",
        sourceDocumentKey: "test_answer_uj",
        authorityClass: "non_authoritative",
        nonAuthoritative: true,
        currentnessStatus: "unproven",
      })
      .returning({ id: legalActVersions.id });

    const [unindexedVersion] = await db
      .insert(legalActVersions)
      .values({
        legalActId: act.id,
        versionKind: "promulgated",
        sourceExpressionId: "unindexed_test",
        sourceDocumentKey: "test_answer_unindexed",
        authorityClass: "authoritative",
        nonAuthoritative: false,
        currentnessStatus: "unproven",
      })
      .returning({ id: legalActVersions.id });

    const [alpha] = await db
      .insert(legalProvisions)
      .values({
        legalActVersionId: currentVersion.id,
        provisionType: "article",
        article: "471",
        citationLabel: "art. 471",
        heading: "Art. 471.",
        text: "Art. 471. KEYWORD_ALPHA Dłużnik odpowiada za nienależyte wykonanie zobowiązania.",
        structuralPath: "art_471",
        ordinal: 1,
      })
      .returning({ id: legalProvisions.id });

    const [beta] = await db
      .insert(legalProvisions)
      .values({
        legalActVersionId: currentVersion.id,
        provisionType: "article",
        article: "556",
        citationLabel: "art. 556",
        heading: "Art. 556.",
        text: "Art. 556. KEYWORD_BETA Kupujący może żądać usunięcia wady w ramach rękojmi.",
        structuralPath: "art_556",
        ordinal: 2,
      })
      .returning({ id: legalProvisions.id });

    const [nonAuthProvision] = await db
      .insert(legalProvisions)
      .values({
        legalActVersionId: nonAuthoritativeVersion.id,
        provisionType: "article",
        article: "471",
        citationLabel: "art. 471",
        heading: "Art. 471.",
        text: "Art. 471. KEYWORD_ALPHA tekst ujednolicony bez mocy prawnej.",
        structuralPath: "art_471",
        ordinal: 1,
      })
      .returning({ id: legalProvisions.id });

    await indexLegalSearchDocuments(currentVersion.id, { db, embedTexts: fakeEmbed });
    await indexLegalSearchDocuments(nonAuthoritativeVersion.id, { db, embedTexts: fakeEmbed });

    return { act, currentVersion, nonAuthoritativeVersion, unindexedVersion, alpha, beta, nonAuthProvision };
  }

  function detectionWith(issues: LegalIssueDetectionResult["issues"]): DetectLegalIssuesFn {
    const detection: LegalIssueDetectionResult = {
      summary: "Możliwy spór dotyczący wykonania umowy.",
      issues,
    };
    return async () => detection;
  }

  /** A well-behaved fake model: grounds one conclusion in the first supplied source. */
  function groundedAnswer(overrides: Partial<RawFinalAnswerResponse> = {}): GenerateFinalAnswerFn {
    return async (input: GenerateFinalAnswerInput) => ({
      answer: "Odpowiedź oparta na dostarczonych źródłach.",
      conclusions: [
        {
          statement: "Dłużnik może ponosić odpowiedzialność za nienależyte wykonanie zobowiązania.",
          support: [{ sourceId: input.sources[0].sourceId }],
        },
      ],
      alternativePaths: [],
      uncertainties: [],
      ...overrides,
    });
  }

  /**
   * A well-behaved fake stage-1 verifier: confirms every conclusion with direct_support,
   * using the source's own full text as the "excerpt" — trivially a verbatim substring of
   * itself, so it always survives the code-level evidence.ts validation.
   */
  const supportAllVerifier: VerifyConclusionSupportFn = async (input) => {
    return input.conclusions.map((conclusion) => ({
      conclusionIndex: conclusion.conclusionIndex,
      verdict: "direct_support" as const,
      reason: "Treść źródła wprost potwierdza twierdzenie.",
      evidence: conclusion.sources.map((s) => ({ sourceId: s.sourceId, excerpt: s.text })),
    }));
  };

  /** A fake stage-1 verifier that rejects every conclusion regardless of plausibility — never rescues via memory. */
  const rejectAllVerifier: VerifyConclusionSupportFn = async (input) => {
    return input.conclusions.map((conclusion) => ({
      conclusionIndex: conclusion.conclusionIndex,
      verdict: "no_support" as const,
      reason: "Źródło nie dotyczy substantywnie tego twierdzenia.",
      evidence: [],
    }));
  };

  /** A well-behaved fake stage-2 skeptic: finds no unsupported leap in anything it reviews. */
  const noLeapSkeptic: RunSkepticalVerificationFn = async (input) => {
    return input.conclusions.map((conclusion) => ({
      conclusionIndex: conclusion.conclusionIndex,
      hasUnsupportedLeap: false,
      reason: "Potwierdzony dowód w pełni ustanawia twierdzenie.",
    }));
  };

  /** A fake stage-2 skeptic that always finds an unsupported leap — for testing stage-2 rejection. */
  const alwaysLeapSkeptic: RunSkepticalVerificationFn = async (input) => {
    return input.conclusions.map((conclusion) => ({
      conclusionIndex: conclusion.conclusionIndex,
      hasUnsupportedLeap: true,
      reason: "Twierdzenie rozszerza zakres przepisu poza to, co ustanawia dowód.",
    }));
  };

  it("rejects an empty legalActVersionIds array as a hard safety boundary", async () => {
    if (!db) throw new Error("unreachable");

    await expect(
      answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
      }),
    ).rejects.toThrow(LegalIssueInvestigationError);
  });

  it("never invokes the final-answer model when retrieval finds zero provisions", async () => {
    const { unindexedVersion } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const generateFinalAnswer = vi.fn();

    const result = await answerLegalProblem({
      problemDescription: "opis problemu bez pokrycia w korpusie",
      legalActVersionIds: [unindexedVersion.id],
      db,
      embedTexts: fakeEmbed,
      detectIssues: detectionWith([
        {
          label: "zagadnienie bez pokrycia",
          likelihood: "needs_more_information",
          rationale: "rationale",
          retrievalQueries: ["KEYWORD_NONEXISTENT"],
        },
      ]),
      generateFinalAnswer,
    });

    expect(generateFinalAnswer).not.toHaveBeenCalled();
    expect(result.status).toBe("insufficient_evidence");
    expect(result.conclusions).toEqual([]);
    expect(result.sources).toEqual([]);
    // the unsupported hypothesis is preserved as an alternative path, never promoted to a conclusion
    expect(result.alternativePaths).toHaveLength(1);
    expect(result.alternativePaths[0].issueLabel).toBe("zagadnienie bez pokrycia");
    expect(result.alternativePaths[0].support).toEqual([]);
  });

  it("returns a grounded conclusion with a valid, fully resolved source reference", async () => {
    const { currentVersion, alpha } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const result = await answerLegalProblem({
      problemDescription: "firma remontowa źle zrobiła remont i nie chce oddać pieniędzy",
      legalActVersionIds: [currentVersion.id],
      db,
      embedTexts: fakeEmbed,
      detectIssues: detectionWith([
        {
          label: "nienależyte wykonanie zobowiązania",
          likelihood: "most_likely",
          rationale: "rationale",
          retrievalQueries: ["KEYWORD_ALPHA"],
        },
      ]),
      generateFinalAnswer: groundedAnswer(),
      verifyConclusionSupport: supportAllVerifier,
      runSkepticalVerification: noLeapSkeptic,
    });

    expect(result.status).toBe("answered");
    expect(result.conclusions).toHaveLength(1);
    expect(result.conclusions[0].support).toHaveLength(1);
    expect(result.conclusions[0].support[0]).toMatchObject({
      legalProvisionId: alpha.id,
      citationLabel: "art. 471",
      legalActVersionId: currentVersion.id,
      versionKind: "promulgated",
      authorityClass: "authoritative",
      currentnessStatus: "unproven",
      sourceExpressionId: "ogl",
    });
  });

  it("supports multiple conclusions backed by different provisions", async () => {
    const { currentVersion, alpha, beta } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const result = await answerLegalProblem({
      problemDescription: "firma remontowa źle zrobiła remont i nie chce oddać pieniędzy",
      legalActVersionIds: [currentVersion.id],
      limitPerQuery: 1,
      db,
      embedTexts: fakeEmbed,
      detectIssues: detectionWith([
        {
          label: "nienależyte wykonanie zobowiązania",
          likelihood: "most_likely",
          rationale: "rationale",
          retrievalQueries: ["KEYWORD_ALPHA"],
        },
        {
          label: "rękojmia za wady",
          likelihood: "possible",
          rationale: "rationale",
          retrievalQueries: ["KEYWORD_BETA"],
        },
      ]),
      generateFinalAnswer: async (input) => ({
        answer: "Odpowiedź.",
        conclusions: input.sources.map((source) => ({
          statement: `Teza dotycząca ${source.citationLabel}.`,
          support: [{ sourceId: source.sourceId }],
        })),
        alternativePaths: [],
        uncertainties: [],
      }),
      verifyConclusionSupport: supportAllVerifier,
      runSkepticalVerification: noLeapSkeptic,
    });

    expect(result.conclusions).toHaveLength(2);
    const citedProvisionIds = result.conclusions.flatMap((c) => c.support.map((s) => s.legalProvisionId)).sort();
    expect(citedProvisionIds).toEqual([alpha.id, beta.id].sort());
  });

  it("preserves alternative legal paths distinct from verified conclusions", async () => {
    const { currentVersion, alpha } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const result = await answerLegalProblem({
      problemDescription: "opis problemu",
      legalActVersionIds: [currentVersion.id],
      db,
      embedTexts: fakeEmbed,
      detectIssues: detectionWith([
        {
          label: "nienależyte wykonanie zobowiązania",
          likelihood: "most_likely",
          rationale: "rationale",
          retrievalQueries: ["KEYWORD_ALPHA"],
        },
      ]),
      generateFinalAnswer: async (input) => ({
        answer: "Odpowiedź.",
        conclusions: [
          { statement: "Teza główna.", support: [{ sourceId: input.sources[0].sourceId }] },
        ],
        alternativePaths: [
          {
            issueLabel: "odstąpienie od umowy",
            explanation: "Korpus nie zawiera przepisów o odstąpieniu od umowy.",
            support: [],
          },
        ],
        uncertainties: ["Nie wiadomo, czy strony ustaliły termin wykonania."],
      }),
      verifyConclusionSupport: supportAllVerifier,
      runSkepticalVerification: noLeapSkeptic,
    });

    expect(result.conclusions).toHaveLength(1);
    expect(result.alternativePaths).toHaveLength(1);
    expect(result.alternativePaths[0].support).toEqual([]);
    // the model's own uncertainty is preserved, plus a deterministic currentness caveat
    // (see the dedicated "authority/currentness caveats" tests below) since the cited
    // fixture source has currentnessStatus "unproven".
    expect(result.uncertainties).toContain("Nie wiadomo, czy strony ustaliły termin wykonania.");
    expect(result.conclusions[0].support[0].legalProvisionId).toBe(alpha.id);
  });

  it("refuses to fabricate a citation if an injected model returns an unknown SOURCE_X (defense in depth)", async () => {
    const { currentVersion } = await seedFixture();
    if (!db) throw new Error("unreachable");

    await expect(
      answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          {
            label: "issue",
            likelihood: "possible",
            rationale: "rationale",
            retrievalQueries: ["KEYWORD_ALPHA"],
          },
        ]),
        generateFinalAnswer: async () => ({
          answer: "Odpowiedź.",
          conclusions: [{ statement: "Teza.", support: [{ sourceId: "SOURCE_FABRICATED" }] }],
          alternativePaths: [],
          uncertainties: [],
        }),
      }),
    ).rejects.toThrow(LegalAnswerError);
  });

  it("preserves non-authoritative source metadata rather than describing it as binding law", async () => {
    const { nonAuthoritativeVersion, nonAuthProvision } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const result = await answerLegalProblem({
      problemDescription: "opis problemu",
      legalActVersionIds: [nonAuthoritativeVersion.id],
      db,
      embedTexts: fakeEmbed,
      detectIssues: detectionWith([
        {
          label: "issue",
          likelihood: "possible",
          rationale: "rationale",
          retrievalQueries: ["KEYWORD_ALPHA"],
        },
      ]),
      generateFinalAnswer: groundedAnswer(),
      verifyConclusionSupport: supportAllVerifier,
      runSkepticalVerification: noLeapSkeptic,
    });

    expect(result.conclusions[0].support[0]).toMatchObject({
      legalProvisionId: nonAuthProvision.id,
      authorityClass: "non_authoritative",
      versionKind: "unified",
      currentnessStatus: "unproven",
    });
  });

  it("preserves currentness-unproven/historical metadata rather than implying current law", async () => {
    const { currentVersion, alpha } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const result = await answerLegalProblem({
      problemDescription: "opis problemu",
      legalActVersionIds: [currentVersion.id],
      db,
      embedTexts: fakeEmbed,
      detectIssues: detectionWith([
        { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
      ]),
      generateFinalAnswer: groundedAnswer(),
      verifyConclusionSupport: supportAllVerifier,
      runSkepticalVerification: noLeapSkeptic,
    });

    // versionKind "promulgated" + currentnessStatus "unproven" must survive untouched —
    // the orchestration layer never upgrades these to imply current/binding law.
    expect(result.conclusions[0].support[0].versionKind).toBe("promulgated");
    expect(result.conclusions[0].support[0].currentnessStatus).toBe("unproven");
    expect(result.sources[0].versionKind).toBe("promulgated");
    expect(result.sources[0].currentnessStatus).toBe("unproven");
    void alpha;
  });

  it("packs duplicate provisions once even when found via multiple issues/queries", async () => {
    const { currentVersion } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const result = await answerLegalProblem({
      problemDescription: "opis problemu",
      legalActVersionIds: [currentVersion.id],
      limitPerQuery: 5,
      db,
      embedTexts: fakeEmbed,
      detectIssues: detectionWith([
        {
          label: "issue A",
          likelihood: "most_likely",
          rationale: "rationale",
          retrievalQueries: ["KEYWORD_ALPHA"],
        },
        {
          label: "issue B",
          likelihood: "possible",
          // same query again — must surface the same provision, not duplicate it in sources
          retrievalQueries: ["KEYWORD_ALPHA"],
          rationale: "rationale",
        },
      ]),
      generateFinalAnswer: groundedAnswer(),
      verifyConclusionSupport: supportAllVerifier,
      runSkepticalVerification: noLeapSkeptic,
    });

    const provisionIds = result.sources.map((s) => s.legalProvisionId);
    expect(provisionIds).toHaveLength(new Set(provisionIds).size);
  });

  it("the final response never contains a source outside the supplied retrieval evidence", async () => {
    const { currentVersion } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const result = await answerLegalProblem({
      problemDescription: "opis problemu",
      legalActVersionIds: [currentVersion.id],
      db,
      embedTexts: fakeEmbed,
      detectIssues: detectionWith([
        { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
      ]),
      generateFinalAnswer: groundedAnswer(),
      verifyConclusionSupport: supportAllVerifier,
      runSkepticalVerification: noLeapSkeptic,
    });

    const suppliedIds = new Set(result.sources.map((s) => s.legalProvisionId));
    for (const conclusion of result.conclusions) {
      for (const support of conclusion.support) {
        expect(suppliedIds.has(support.legalProvisionId)).toBe(true);
      }
    }
  });

  describe("claim-to-source support verification", () => {
    it("A: a conclusion whose cited source actually supports it survives as a verified conclusion", async () => {
      const { currentVersion, alpha } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: groundedAnswer(),
        verifyConclusionSupport: supportAllVerifier,
        runSkepticalVerification: noLeapSkeptic,
      });

      expect(result.status).toBe("answered");
      expect(result.conclusions).toHaveLength(1);
      expect(result.conclusions[0].support[0].legalProvisionId).toBe(alpha.id);
    });

    it("invented excerpt: verdict=direct_support but the returned excerpt does not occur verbatim in the source text is deterministically rejected", async () => {
      const { currentVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const invalidExcerptVerifier: VerifyConclusionSupportFn = async (input) => {
        return input.conclusions.map((conclusion) => ({
          conclusionIndex: conclusion.conclusionIndex,
          verdict: "direct_support" as const,
          reason: "reason",
          // Not present verbatim anywhere in the fixture's art. 471 text — an invented/paraphrased excerpt.
          evidence: [{ sourceId: conclusion.sources[0].sourceId, excerpt: "Sąsiad odpowiada za wycięcie drzewa bez zgody właściciela." }],
        }));
      };
      const skepticSpy = vi.fn(noLeapSkeptic);

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: groundedAnswer(),
        verifyConclusionSupport: invalidExcerptVerifier,
        runSkepticalVerification: skepticSpy,
      });

      expect(result.status).toBe("insufficient_evidence");
      expect(result.conclusions).toEqual([]);
      // fail-closed before stage 2: an invented excerpt never even reaches the skeptical pass
      expect(skepticSpy).not.toHaveBeenCalled();
    });

    it("partial support: verdict=partial_support is rejected, never upgraded to a verified conclusion", async () => {
      const { currentVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const partialSupportVerifier: VerifyConclusionSupportFn = async (input) => {
        return input.conclusions.map((conclusion) => ({
          conclusionIndex: conclusion.conclusionIndex,
          verdict: "partial_support" as const,
          reason: "Źródło potwierdza tylko część szerszej tezy — resztę pomija.",
          evidence: [],
        }));
      };
      const skepticSpy = vi.fn(noLeapSkeptic);

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: groundedAnswer(),
        verifyConclusionSupport: partialSupportVerifier,
        runSkepticalVerification: skepticSpy,
      });

      expect(result.status).toBe("insufficient_evidence");
      expect(result.conclusions).toEqual([]);
      expect(skepticSpy).not.toHaveBeenCalled();
    });

    it("procedural-to-substantive scope expansion: stage 1 passes but the skeptical pass catches it and rejects", async () => {
      const { currentVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      // Stage 1 is fooled: the excerpt is real and verbatim, so code-level validation passes.
      // Only the adversarial skeptical pass is positioned to catch that a procedural debtor-
      // liability provision has been generalized into an unrelated neighbor-tort claim.
      const result = await answerLegalProblem({
        problemDescription: "sąsiad ściął moje drzewo bez pytania, czy mogę żądać odszkodowania?",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "roszczenie odszkodowawcze wobec sąsiada", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: async (input) => ({
          answer: "Błędna odpowiedź oparta na nietrafnym przepisie.",
          conclusions: [
            {
              statement: "Sąsiad ponosi odpowiedzialność odszkodowawczą za wycięcie drzewa na podstawie art. 471.",
              support: [{ sourceId: input.sources[0].sourceId }],
            },
          ],
          alternativePaths: [],
          uncertainties: [],
        }),
        verifyConclusionSupport: supportAllVerifier,
        runSkepticalVerification: alwaysLeapSkeptic,
      });

      expect(result.status).toBe("insufficient_evidence");
      expect(result.conclusions).toEqual([]);
      expect(
        result.alternativePaths.some((path) => path.issueLabel.includes("Sąsiad ponosi odpowiedzialność odszkodowawczą")),
      ).toBe(true);
    });

    it("first verifier passes, skeptic finds no unsupported leap: conclusion survives", async () => {
      const { currentVersion, alpha } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const skepticSpy = vi.fn(noLeapSkeptic);

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: groundedAnswer(),
        verifyConclusionSupport: supportAllVerifier,
        runSkepticalVerification: skepticSpy,
      });

      expect(result.status).toBe("answered");
      expect(result.conclusions).toHaveLength(1);
      expect(result.conclusions[0].support[0].legalProvisionId).toBe(alpha.id);
      expect(skepticSpy).toHaveBeenCalledTimes(1);
    });

    it("batching: exactly one strict-verification call and one skeptical call regardless of the number of conclusions (never one call per conclusion)", async () => {
      const { currentVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const verifySpy = vi.fn(supportAllVerifier);
      const skepticSpy = vi.fn(noLeapSkeptic);

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [currentVersion.id],
        limitPerQuery: 5,
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue A", likelihood: "most_likely", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
          { label: "issue B", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_BETA"] },
        ]),
        generateFinalAnswer: async (input) => ({
          answer: "Odpowiedź.",
          conclusions: input.sources.map((source) => ({
            statement: `Teza dotycząca ${source.citationLabel}.`,
            support: [{ sourceId: source.sourceId }],
          })),
          alternativePaths: [],
          uncertainties: [],
        }),
        verifyConclusionSupport: verifySpy,
        runSkepticalVerification: skepticSpy,
      });

      expect(result.conclusions.length).toBeGreaterThan(1);
      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(skepticSpy).toHaveBeenCalledTimes(1);
    });

    it("B: a real citation that does not substantively support the exact claim is demoted, not kept as a conclusion", async () => {
      const { currentVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      // Simulates the observed live failure mode: a real, validly-cited source (art. 471,
      // about debtor liability for non-performance) is cited to support an unrelated legal
      // proposition (neighbor property/tort). The verifier's job is to catch this mismatch.
      const misapplyingVerifier: VerifyConclusionSupportFn = async (input) => {
        return input.conclusions.map((conclusion) => ({
          conclusionIndex: conclusion.conclusionIndex,
          verdict: "no_support" as const,
          reason: "Źródło dotyczy odpowiedzialności dłużnika za nienależyte wykonanie zobowiązania, a nie roszczeń sąsiedzkich za wycięcie drzewa.",
          evidence: [],
        }));
      };

      const result = await answerLegalProblem({
        problemDescription: "sąsiad ściął moje drzewo bez pytania, czy mogę żądać odszkodowania?",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "roszczenie odszkodowawcze wobec sąsiada", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: async (input) => ({
          answer: "Błędna odpowiedź oparta na nietrafnym przepisie.",
          conclusions: [
            {
              statement: "Sąsiad ponosi odpowiedzialność odszkodowawczą za wycięcie drzewa na podstawie art. 471.",
              support: [{ sourceId: input.sources[0].sourceId }],
            },
          ],
          alternativePaths: [],
          uncertainties: [],
        }),
        verifyConclusionSupport: misapplyingVerifier,
      });

      expect(result.status).toBe("insufficient_evidence");
      expect(result.conclusions).toEqual([]);
      expect(
        result.alternativePaths.some((path) =>
          path.issueLabel.includes("Sąsiad ponosi odpowiedzialność odszkodowawczą"),
        ),
      ).toBe(true);
      const demoted = result.alternativePaths.find((path) => path.issueLabel.includes("Sąsiad ponosi"));
      expect(demoted?.support).toEqual([]);
    });

    it("C: a generally plausible proposition is not rescued by model memory — verifier's judgment on the supplied text is authoritative", async () => {
      const { currentVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        // "Dłużnik może ponosić odpowiedzialność..." is a plausible general statement of Polish
        // contract law, but the verifier must judge only whether the supplied source text
        // substantiates it — this fake always says no, and the orchestrator must honor that.
        generateFinalAnswer: groundedAnswer(),
        verifyConclusionSupport: rejectAllVerifier,
      });

      expect(result.status).toBe("insufficient_evidence");
      expect(result.conclusions).toEqual([]);
    });

    it("D: a mixed answer keeps only the supported conclusion and demotes the unsupported one", async () => {
      const { currentVersion, alpha } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const mixedVerifier: VerifyConclusionSupportFn = async (input) => {
        return input.conclusions.map((conclusion) => ({
          conclusionIndex: conclusion.conclusionIndex,
          verdict: conclusion.conclusionIndex === 0 ? ("direct_support" as const) : ("no_support" as const),
          reason: conclusion.conclusionIndex === 0 ? "Źródło potwierdza tezę." : "Źródło nie potwierdza tezy.",
          evidence:
            conclusion.conclusionIndex === 0
              ? conclusion.sources.map((s) => ({ sourceId: s.sourceId, excerpt: s.text }))
              : [],
        }));
      };

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: async (input) => ({
          answer: "Odpowiedź.",
          conclusions: [
            { statement: "Teza wspierana.", support: [{ sourceId: input.sources[0].sourceId }] },
            { statement: "Teza niewspierana.", support: [{ sourceId: input.sources[0].sourceId }] },
          ],
          alternativePaths: [],
          uncertainties: [],
        }),
        verifyConclusionSupport: mixedVerifier,
        runSkepticalVerification: noLeapSkeptic,
      });

      expect(result.status).toBe("answered");
      expect(result.conclusions).toHaveLength(1);
      expect(result.conclusions[0].statement).toBe("Teza wspierana.");
      expect(result.conclusions[0].support[0].legalProvisionId).toBe(alpha.id);
      expect(result.alternativePaths.some((path) => path.issueLabel === "Teza niewspierana.")).toBe(true);
    });

    it("E: when all conclusions fail verification, the result is a safe insufficient-evidence answer rather than an apparently grounded one", async () => {
      const { currentVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: groundedAnswer(),
        verifyConclusionSupport: rejectAllVerifier,
      });

      expect(result.status).toBe("insufficient_evidence");
      expect(result.conclusions).toEqual([]);
      // the draft model's own (now-retracted) answer text must not be surfaced as if it were grounded
      expect(result.answer).not.toBe("Odpowiedź oparta na dostarczonych źródłach.");
    });

    it("F: rejects an unknown SOURCE_X returned by the verifier as supportingSourceIds (defense in depth)", async () => {
      const { currentVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const fabricatingVerifier: VerifyConclusionSupportFn = async (input) => {
        return input.conclusions.map((conclusion) => ({
          conclusionIndex: conclusion.conclusionIndex,
          verdict: "direct_support" as const,
          reason: "reason",
          evidence: [{ sourceId: "SOURCE_FABRICATED_BY_VERIFIER", excerpt: "cokolwiek" }],
        }));
      };

      await expect(
        answerLegalProblem({
          problemDescription: "opis problemu",
          legalActVersionIds: [currentVersion.id],
          db,
          embedTexts: fakeEmbed,
          detectIssues: detectionWith([
            { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
          ]),
          generateFinalAnswer: groundedAnswer(),
          verifyConclusionSupport: fabricatingVerifier,
        }),
      ).rejects.toThrow(LegalAnswerError);
    });

    it("G: authority/currentness caveats remain intact for a verified conclusion citing a non-authoritative source", async () => {
      const { nonAuthoritativeVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [nonAuthoritativeVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: groundedAnswer({ uncertainties: [] }),
        verifyConclusionSupport: supportAllVerifier,
        runSkepticalVerification: noLeapSkeptic,
      });

      expect(result.status).toBe("answered");
      expect(result.uncertainties.some((entry) => entry.toLowerCase().includes("nieautorytatywny"))).toBe(true);
    });

    it("H: the explicit legalActVersionIds requirement is unaffected by the verification stage", async () => {
      if (!db) throw new Error("unreachable");

      await expect(
        answerLegalProblem({
          problemDescription: "opis problemu",
          legalActVersionIds: [],
          db,
          embedTexts: fakeEmbed,
          detectIssues: detectionWith([
            { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
          ]),
          generateFinalAnswer: groundedAnswer(),
          verifyConclusionSupport: supportAllVerifier,
          runSkepticalVerification: noLeapSkeptic,
        }),
      ).rejects.toThrow(LegalIssueInvestigationError);
    });
  });

  describe("deterministic post-verification answer prose", () => {
    it("1: the final answer contains the verified claim and not the rejected one, even though both were in the draft prose", async () => {
      const { currentVersion, alpha, beta } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const mixedVerifier: VerifyConclusionSupportFn = async (input) => {
        return input.conclusions.map((conclusion) => ({
          conclusionIndex: conclusion.conclusionIndex,
          verdict: conclusion.conclusionIndex === 0 ? ("direct_support" as const) : ("no_support" as const),
          reason: conclusion.conclusionIndex === 0 ? "Źródło potwierdza tezę." : "Źródło nie potwierdza tezy.",
          evidence:
            conclusion.conclusionIndex === 0
              ? conclusion.sources.map((s) => ({ sourceId: s.sourceId, excerpt: s.text }))
              : [],
        }));
      };

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [currentVersion.id],
        limitPerQuery: 1,
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue A", likelihood: "most_likely", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
          { label: "issue B", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_BETA"] },
        ]),
        generateFinalAnswer: async (input) => ({
          // The draft prose narrates BOTH claims — this is exactly the leak the fix must close.
          answer:
            "TWIERDZENIE_ZWERYFIKOWANE: dłużnik odpowiada za nienależyte wykonanie. TWIERDZENIE_ODRZUCONE: kupujący nie ma żadnych praw z rękojmi.",
          conclusions: [
            { statement: "TWIERDZENIE_ZWERYFIKOWANE: dłużnik odpowiada za nienależyte wykonanie.", support: [{ sourceId: input.sources[0].sourceId }] },
            { statement: "TWIERDZENIE_ODRZUCONE: kupujący nie ma żadnych praw z rękojmi.", support: [{ sourceId: input.sources[1].sourceId }] },
          ],
          alternativePaths: [],
          uncertainties: [],
        }),
        verifyConclusionSupport: mixedVerifier,
        runSkepticalVerification: noLeapSkeptic,
      });

      expect(result.status).toBe("answered");
      expect(result.answer).toContain("TWIERDZENIE_ZWERYFIKOWANE");
      expect(result.answer).not.toContain("TWIERDZENIE_ODRZUCONE");
      void alpha;
      void beta;
    });

    it("2: when only rejected claims exist, the draft prose is never surfaced anywhere in the response", async () => {
      const { currentVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: async (input) => ({
          answer: "TWIERDZENIE_TYLKO_W_DRAFCIE: to zdanie nigdy nie powinno trafić do użytkownika.",
          conclusions: [
            { statement: "Teza odrzucona.", support: [{ sourceId: input.sources[0].sourceId }] },
          ],
          alternativePaths: [],
          uncertainties: [],
        }),
        verifyConclusionSupport: rejectAllVerifier,
      });

      expect(result.status).toBe("insufficient_evidence");
      expect(result.answer).not.toContain("TWIERDZENIE_TYLKO_W_DRAFCIE");
      expect(JSON.stringify(result)).not.toContain("TWIERDZENIE_TYLKO_W_DRAFCIE");
    });

    it("3: authority/currentness caveats still appear in the deterministically rebuilt answer's uncertainties", async () => {
      const { nonAuthoritativeVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [nonAuthoritativeVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: groundedAnswer({ uncertainties: [] }),
        verifyConclusionSupport: supportAllVerifier,
        runSkepticalVerification: noLeapSkeptic,
      });

      expect(result.status).toBe("answered");
      expect(result.uncertainties.some((entry) => entry.toLowerCase().includes("nieautorytatywny"))).toBe(true);
      expect(result.answer.toLowerCase()).toContain("nieautorytatywny");
    });

    it("4: verified citation labels are rendered inline in the final answer prose", async () => {
      const { currentVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: groundedAnswer(),
        verifyConclusionSupport: supportAllVerifier,
        runSkepticalVerification: noLeapSkeptic,
      });

      expect(result.status).toBe("answered");
      expect(result.answer).toContain("art. 471");
    });

    it("5: no extra OpenAI-style call is made for final prose construction — only generateFinalAnswer, verifyConclusionSupport, and runSkepticalVerification are invoked, each exactly once", async () => {
      const { currentVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const generateSpy = vi.fn(groundedAnswer());
      const verifySpy = vi.fn(supportAllVerifier);
      const skepticSpy = vi.fn(noLeapSkeptic);

      await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: generateSpy,
        verifyConclusionSupport: verifySpy,
        runSkepticalVerification: skepticSpy,
      });

      expect(generateSpy).toHaveBeenCalledTimes(1);
      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(skepticSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("deterministic authority/currentness caveats", () => {
    it("always adds a currentness caveat when a cited source has unproven currentness, regardless of the model's own prose", async () => {
      const { currentVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        // the fake model deliberately omits any currentness caveat of its own
        generateFinalAnswer: groundedAnswer({ uncertainties: [] }),
        verifyConclusionSupport: supportAllVerifier,
        runSkepticalVerification: noLeapSkeptic,
      });

      expect(
        result.uncertainties.some((entry) => entry.toLowerCase().includes("aktualność")),
      ).toBe(true);
    });

    it("always adds a non-authoritative caveat when a cited source is non-authoritative", async () => {
      const { nonAuthoritativeVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [nonAuthoritativeVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: groundedAnswer({ uncertainties: [] }),
        verifyConclusionSupport: supportAllVerifier,
        runSkepticalVerification: noLeapSkeptic,
      });

      expect(
        result.uncertainties.some((entry) => entry.toLowerCase().includes("nieautorytatywny")),
      ).toBe(true);
    });

    it("does not add caveats when nothing was actually cited (insufficient-evidence path)", async () => {
      const { unindexedVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const result = await answerLegalProblem({
        problemDescription: "opis problemu bez pokrycia",
        legalActVersionIds: [unindexedVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          {
            label: "issue",
            likelihood: "needs_more_information",
            rationale: "rationale",
            retrievalQueries: ["KEYWORD_NONEXISTENT"],
          },
        ]),
        generateFinalAnswer: vi.fn(),
      });

      expect(result.uncertainties.some((entry) => entry.toLowerCase().includes("aktualność"))).toBe(false);
    });
  });

  describe("source-first recovery pass", () => {
    /**
     * A verifier fake that rejects any statement UNLESS it was produced by the recovery pass
     * (marked with a "RECOVERY_" prefix) — lets a single injected verifyConclusionSupport
     * simulate "first draft rejected, recovery draft grounded" across the two separate
     * verifyDraftConclusions calls the real pipeline makes (first pass, then recovery).
     */
    const rejectDraftAcceptRecoveryVerifier: VerifyConclusionSupportFn = async (input) => {
      return input.conclusions.map((conclusion) => {
        const isRecovery = conclusion.statement.startsWith("RECOVERY_");
        return {
          conclusionIndex: conclusion.conclusionIndex,
          verdict: isRecovery ? ("direct_support" as const) : ("no_support" as const),
          reason: isRecovery ? "Źródło wprost ustanawia tezę odzyskaną." : "Nie potwierdzono.",
          evidence: isRecovery ? conclusion.sources.map((s) => ({ sourceId: s.sourceId, excerpt: s.text })) : [],
        };
      });
    };

    /** A well-behaved fake stage-2 skeptic — reused from the outer describe's noLeapSkeptic pattern. */
    const recoveryNoLeapSkeptic = noLeapSkeptic;

    it("A: normal generation succeeds => recovery is NOT called", async () => {
      const { currentVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const recoverySpy = vi.fn();

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: groundedAnswer(),
        verifyConclusionSupport: supportAllVerifier,
        runSkepticalVerification: noLeapSkeptic,
        generateRecoveryConclusions: recoverySpy,
      });

      expect(result.status).toBe("answered");
      expect(recoverySpy).not.toHaveBeenCalled();
    });

    it("B: zero retrieval => recovery is NOT called", async () => {
      const { unindexedVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const recoverySpy = vi.fn();

      const result = await answerLegalProblem({
        problemDescription: "opis problemu bez pokrycia w korpusie",
        legalActVersionIds: [unindexedVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          {
            label: "zagadnienie bez pokrycia",
            likelihood: "needs_more_information",
            rationale: "rationale",
            retrievalQueries: ["KEYWORD_NONEXISTENT"],
          },
        ]),
        generateFinalAnswer: vi.fn(),
        generateRecoveryConclusions: recoverySpy,
      });

      expect(result.status).toBe("insufficient_evidence");
      expect(recoverySpy).not.toHaveBeenCalled();
    });

    it("C: first pass all rejected + relevant sources exist => recovery called exactly once", async () => {
      const { currentVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const recoverySpy = vi.fn(async () => ({ conclusions: [], uncertainties: [] }));

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: groundedAnswer(),
        verifyConclusionSupport: rejectAllVerifier,
        generateRecoveryConclusions: recoverySpy,
      });

      expect(result.status).toBe("insufficient_evidence");
      expect(recoverySpy).toHaveBeenCalledTimes(1);
    });

    it("D: a recovery conclusion with a real, self-validated excerpt passes through the full verification pipeline and survives", async () => {
      const { currentVersion, alpha } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const recoverySpy: GenerateRecoveryConclusionsFn = async (input) => ({
        conclusions: [
          {
            statement: "RECOVERY_Dłużnik odpowiada za nienależyte wykonanie zobowiązania.",
            support: [{ sourceId: input.sources[0].sourceId, excerpt: input.sources[0].text }],
          },
        ],
        uncertainties: [],
      });

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: async (input) => ({
          answer: "Odpowiedź.",
          conclusions: [{ statement: "Teza odrzucona w pierwszej próbie.", support: [{ sourceId: input.sources[0].sourceId }] }],
          alternativePaths: [],
          uncertainties: [],
        }),
        verifyConclusionSupport: rejectDraftAcceptRecoveryVerifier,
        runSkepticalVerification: recoveryNoLeapSkeptic,
        generateRecoveryConclusions: recoverySpy,
      });

      expect(result.status).toBe("answered");
      expect(result.conclusions).toHaveLength(1);
      expect(result.conclusions[0].statement).toBe("RECOVERY_Dłużnik odpowiada za nienależyte wykonanie zobowiązania.");
      expect(result.conclusions[0].support[0].legalProvisionId).toBe(alpha.id);
    });

    it("E: a recovery conclusion with an invented (non-verbatim) excerpt is rejected before it ever reaches the verifier", async () => {
      const { currentVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const verifySpy = vi.fn(rejectAllVerifier);
      const recoverySpy: GenerateRecoveryConclusionsFn = async (input) => ({
        conclusions: [
          {
            statement: "RECOVERY_Twierdzenie z wymyślonym cytatem.",
            support: [{ sourceId: input.sources[0].sourceId, excerpt: "Ten fragment nie istnieje w żadnym źródle." }],
          },
        ],
        uncertainties: [],
      });

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: groundedAnswer(),
        verifyConclusionSupport: verifySpy,
        generateRecoveryConclusions: recoverySpy,
      });

      expect(result.status).toBe("insufficient_evidence");
      expect(result.conclusions).toEqual([]);
      // only the first pass ever reached the verifier — the fabricated recovery excerpt was
      // dropped deterministically before verifyDraftConclusions was even called a second time
      expect(verifySpy).toHaveBeenCalledTimes(1);
    });

    it("F: a recovery conclusion citing an unknown SOURCE_X is rejected before it ever reaches the verifier", async () => {
      const { currentVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const verifySpy = vi.fn(rejectAllVerifier);
      const recoverySpy: GenerateRecoveryConclusionsFn = async () => ({
        conclusions: [
          {
            statement: "RECOVERY_Twierdzenie z nieistniejącym źródłem.",
            support: [{ sourceId: "SOURCE_FABRICATED_BY_RECOVERY", excerpt: "cokolwiek" }],
          },
        ],
        uncertainties: [],
      });

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: groundedAnswer(),
        verifyConclusionSupport: verifySpy,
        generateRecoveryConclusions: recoverySpy,
      });

      expect(result.status).toBe("insufficient_evidence");
      expect(result.conclusions).toEqual([]);
      expect(verifySpy).toHaveBeenCalledTimes(1);
    });

    it("G: a recovery conclusion passes strict verification but the skeptic catches an unsupported leap => rejected", async () => {
      const { currentVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const recoverySpy: GenerateRecoveryConclusionsFn = async (input) => ({
        conclusions: [
          {
            statement: "RECOVERY_Twierdzenie z nieuprawnionym skokiem logicznym.",
            support: [{ sourceId: input.sources[0].sourceId, excerpt: input.sources[0].text }],
          },
        ],
        uncertainties: [],
      });

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: groundedAnswer(),
        verifyConclusionSupport: rejectDraftAcceptRecoveryVerifier,
        runSkepticalVerification: alwaysLeapSkeptic,
        generateRecoveryConclusions: recoverySpy,
      });

      expect(result.status).toBe("insufficient_evidence");
      expect(result.conclusions).toEqual([]);
      expect(
        result.alternativePaths.some((path) => path.issueLabel.startsWith("RECOVERY_")),
      ).toBe(true);
    });

    it("H: recovery also fails (returns zero conclusions) => final result is insufficient_evidence", async () => {
      const { currentVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const recoverySpy = vi.fn(async () => ({ conclusions: [], uncertainties: [] }));
      const verifySpy = vi.fn(rejectAllVerifier);

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: groundedAnswer(),
        verifyConclusionSupport: verifySpy,
        generateRecoveryConclusions: recoverySpy,
      });

      expect(result.status).toBe("insufficient_evidence");
      expect(recoverySpy).toHaveBeenCalledTimes(1);
      // recovery produced nothing, so verifyDraftConclusions short-circuits without a 2nd call
      expect(verifySpy).toHaveBeenCalledTimes(1);
    });

    it("I: when recovery succeeds, the final answer contains only the recovery conclusions that passed all gates", async () => {
      const { currentVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const recoverySpy: GenerateRecoveryConclusionsFn = async (input) => ({
        conclusions: [
          {
            statement: "RECOVERY_Jedyna zweryfikowana teza.",
            support: [{ sourceId: input.sources[0].sourceId, excerpt: input.sources[0].text }],
          },
        ],
        uncertainties: [],
      });

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: async (input) => ({
          answer: "TWIERDZENIE_TYLKO_W_DRAFCIE_NIGDY_NIE_POWINNO_TRAFIC_DO_UZYTKOWNIKA",
          conclusions: [
            { statement: "Teza odrzucona w pierwszej próbie.", support: [{ sourceId: input.sources[0].sourceId }] },
          ],
          alternativePaths: [],
          uncertainties: [],
        }),
        verifyConclusionSupport: rejectDraftAcceptRecoveryVerifier,
        runSkepticalVerification: recoveryNoLeapSkeptic,
        generateRecoveryConclusions: recoverySpy,
      });

      expect(result.status).toBe("answered");
      expect(result.conclusions).toHaveLength(1);
      expect(result.conclusions[0].statement).toBe("RECOVERY_Jedyna zweryfikowana teza.");
    });

    it("J: no rejected first-pass claim leaks anywhere into the recovery-produced final answer", async () => {
      const { currentVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const recoverySpy: GenerateRecoveryConclusionsFn = async (input) => ({
        conclusions: [
          {
            statement: "RECOVERY_Jedyna zweryfikowana teza.",
            support: [{ sourceId: input.sources[0].sourceId, excerpt: input.sources[0].text }],
          },
        ],
        uncertainties: [],
      });

      const result = await answerLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "issue", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: async (input) => ({
          answer: "TWIERDZENIE_ODRZUCONE_W_PIERWSZEJ_PROBIE_NIGDY_NIE_MOZE_WYCIEC",
          conclusions: [
            { statement: "TWIERDZENIE_ODRZUCONE_W_PIERWSZEJ_PROBIE_NIGDY_NIE_MOZE_WYCIEC", support: [{ sourceId: input.sources[0].sourceId }] },
          ],
          alternativePaths: [],
          uncertainties: [],
        }),
        verifyConclusionSupport: rejectDraftAcceptRecoveryVerifier,
        runSkepticalVerification: recoveryNoLeapSkeptic,
        generateRecoveryConclusions: recoverySpy,
      });

      expect(result.status).toBe("answered");
      // Deliberately checks only the user-facing prose (result.answer), not the whole result:
      // demoted/rejected claims are EXPECTED to remain visible in the structured
      // alternativePaths array for transparency (existing, established design from the prior
      // grounding-stability milestone — see buildDeterministicAnswerText, which only ever
      // renders draftAlternativePaths into prose, never demotedAlternativePaths). The actual
      // leak this guards against is a rejected claim being narrated as if it were verified.
      expect(result.answer).not.toContain("TWIERDZENIE_ODRZUCONE_W_PIERWSZEJ_PROBIE_NIGDY_NIE_MOZE_WYCIEC");
      expect(result.answer).toContain("RECOVERY_Jedyna zweryfikowana teza.");
    });

    it("K: an out-of-domain query does not become an answer merely because a recovery pass exists — recovery is subject to the exact same grounding gates", async () => {
      const { currentVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      // Simulates the adversarial "sąsiad wyciął drzewo" pattern: recovery proposes a
      // plausible-looking claim with a REAL, self-validated excerpt from a real source, but
      // the (unconditionally rejecting) verifier still correctly judges the source doesn't
      // establish this specific proposition — recovery grants no shortcut around that judgment.
      const recoverySpy = vi.fn<GenerateRecoveryConclusionsFn>(async (input) => ({
        conclusions: [
          {
            statement: "RECOVERY_Sąsiad odpowiada odszkodowawczo za wycięcie drzewa.",
            support: [{ sourceId: input.sources[0].sourceId, excerpt: input.sources[0].text }],
          },
        ],
        uncertainties: [],
      }));

      const result = await answerLegalProblem({
        problemDescription: "sąsiad ściął moje drzewo bez pytania, czy mogę żądać odszkodowania?",
        legalActVersionIds: [currentVersion.id],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          { label: "roszczenie odszkodowawcze wobec sąsiada", likelihood: "possible", rationale: "rationale", retrievalQueries: ["KEYWORD_ALPHA"] },
        ]),
        generateFinalAnswer: async (input) => ({
          answer: "Błędna odpowiedź.",
          conclusions: [
            { statement: "Sąsiad ponosi odpowiedzialność za wycięcie drzewa.", support: [{ sourceId: input.sources[0].sourceId }] },
          ],
          alternativePaths: [],
          uncertainties: [],
        }),
        verifyConclusionSupport: rejectAllVerifier,
        generateRecoveryConclusions: recoverySpy,
      });

      expect(result.status).toBe("insufficient_evidence");
      expect(result.conclusions).toEqual([]);
      expect(recoverySpy).toHaveBeenCalledTimes(1);
    });
  });
});
