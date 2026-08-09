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
import type { RawFinalAnswerResponse } from "./schema";
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

  /** A well-behaved fake verifier: confirms every conclusion using exactly the sources it claimed. */
  const supportAllVerifier: VerifyConclusionSupportFn = async (input) => {
    return input.conclusions.map((conclusion) => ({
      conclusionIndex: conclusion.conclusionIndex,
      supported: true,
      reason: "Treść źródła wprost potwierdza twierdzenie.",
      supportingSourceIds: conclusion.sources.map((s) => s.sourceId),
    }));
  };

  /** A fake verifier that rejects every conclusion regardless of plausibility — never rescues via memory. */
  const rejectAllVerifier: VerifyConclusionSupportFn = async (input) => {
    return input.conclusions.map((conclusion) => ({
      conclusionIndex: conclusion.conclusionIndex,
      supported: false,
      reason: "Źródło nie dotyczy substantywnie tego twierdzenia.",
      supportingSourceIds: [],
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
      });

      expect(result.status).toBe("answered");
      expect(result.conclusions).toHaveLength(1);
      expect(result.conclusions[0].support[0].legalProvisionId).toBe(alpha.id);
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
          supported: false,
          reason: "Źródło dotyczy odpowiedzialności dłużnika za nienależyte wykonanie zobowiązania, a nie roszczeń sąsiedzkich za wycięcie drzewa.",
          supportingSourceIds: [],
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
          supported: conclusion.conclusionIndex === 0,
          reason: conclusion.conclusionIndex === 0 ? "Źródło potwierdza tezę." : "Źródło nie potwierdza tezy.",
          supportingSourceIds: conclusion.conclusionIndex === 0 ? conclusion.sources.map((s) => s.sourceId) : [],
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
          supported: true,
          reason: "reason",
          supportingSourceIds: ["SOURCE_FABRICATED_BY_VERIFIER"],
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
          supported: conclusion.conclusionIndex === 0,
          reason: conclusion.conclusionIndex === 0 ? "Źródło potwierdza tezę." : "Źródło nie potwierdza tezy.",
          supportingSourceIds: conclusion.conclusionIndex === 0 ? conclusion.sources.map((s) => s.sourceId) : [],
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
      });

      expect(result.status).toBe("answered");
      expect(result.answer).toContain("art. 471");
    });

    it("5: no extra OpenAI-style call is made for final prose construction — only generateFinalAnswer and verifyConclusionSupport are invoked", async () => {
      const { currentVersion } = await seedFixture();
      if (!db) throw new Error("unreachable");

      const generateSpy = vi.fn(groundedAnswer());
      const verifySpy = vi.fn(supportAllVerifier);

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
      });

      expect(generateSpy).toHaveBeenCalledTimes(1);
      expect(verifySpy).toHaveBeenCalledTimes(1);
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
});
