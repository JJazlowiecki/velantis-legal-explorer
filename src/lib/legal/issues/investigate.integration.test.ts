import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { legalActVersions, legalActs, legalProvisions } from "../../../db/schema";
import { createTestDatabase } from "../../test-support/test-db";
import type { EmbedTextsFn } from "../search/embeddings";
import { indexLegalSearchDocuments } from "../search/indexing";
import type { DetectLegalIssuesFn } from "./detect";
import { capRetrievalQueries, investigateLegalProblem, LegalIssueInvestigationError } from "./investigate";
import type { LegalIssueDetectionResult, LegalIssueHypothesis } from "./schema";

const testDatabase = createTestDatabase();
const describeDatabase = testDatabase ? describe : describe.skip;
const client = testDatabase?.client;
const db = testDatabase?.db;

const TEST_SOURCE = "test_issues_fixture";
const TEST_SOURCE_ID = "TEST/ISSUES/1";
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

/** Shorthand for a single-query, single-target issue fixture — the common case in these tests. */
function issueWithQuery(
  fields: Omit<LegalIssueHypothesis, "retrievalQueries" | "answerTargetIndexes"> & {
    query: string;
    answerTargetIndex?: number;
  },
): LegalIssueHypothesis {
  const answerTargetIndex = fields.answerTargetIndex ?? 1;
  return {
    label: fields.label,
    likelihood: fields.likelihood,
    rationale: fields.rationale,
    answerTargetIndexes: [answerTargetIndex],
    retrievalQueries: [{ query: fields.query, answerTargetIndex }],
  };
}

describeDatabase("investigateLegalProblem", () => {
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
        sourceDocumentKey: "test_issues_current",
        authorityClass: "authoritative",
        nonAuthoritative: false,
        currentnessStatus: "unproven",
      })
      .returning({ id: legalActVersions.id });

    const [historicalVersion] = await db
      .insert(legalActVersions)
      .values({
        legalActId: act.id,
        versionKind: "promulgated",
        sourceExpressionId: "historical_test",
        sourceDocumentKey: "test_issues_historical",
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
        article: "1",
        citationLabel: "art. 1",
        heading: "Art. 1.",
        text: "Art. 1. KEYWORD_ALPHA Dłużnik odpowiada za nienależyte wykonanie zobowiązania.",
        structuralPath: "art_1",
        ordinal: 1,
      })
      .returning({ id: legalProvisions.id });

    const [beta] = await db
      .insert(legalProvisions)
      .values({
        legalActVersionId: currentVersion.id,
        provisionType: "article",
        article: "2",
        citationLabel: "art. 2",
        heading: "Art. 2.",
        text: "Art. 2. KEYWORD_BETA Kupujący może żądać usunięcia wady w ramach rękojmi.",
        structuralPath: "art_2",
        ordinal: 2,
      })
      .returning({ id: legalProvisions.id });

    // Identical KEYWORD_ALPHA content in a historical version: must never leak into
    // a search scoped to currentVersion only.
    await db.insert(legalProvisions).values({
      legalActVersionId: historicalVersion.id,
      provisionType: "article",
      article: "1",
      citationLabel: "art. 1",
      heading: "Art. 1.",
      text: "Art. 1. KEYWORD_ALPHA historyczne brzmienie przepisu.",
      structuralPath: "art_1",
      ordinal: 1,
    });

    // A version with no indexed search documents at all (never indexed), used to model
    // an issue hypothesis genuinely unsupported by retrieval in the given corpus.
    const [unindexedVersion] = await db
      .insert(legalActVersions)
      .values({
        legalActId: act.id,
        versionKind: "promulgated",
        sourceExpressionId: "unindexed_test",
        sourceDocumentKey: "test_issues_unindexed",
        authorityClass: "authoritative",
        nonAuthoritative: false,
        currentnessStatus: "unproven",
      })
      .returning({ id: legalActVersions.id });

    await indexLegalSearchDocuments(currentVersion.id, { db, embedTexts: fakeEmbed });
    await indexLegalSearchDocuments(historicalVersion.id, { db, embedTexts: fakeEmbed });

    return { act, currentVersion, historicalVersion, unindexedVersion, alpha, beta };
  }

  function detectionWith(
    issues: LegalIssueHypothesis[],
    answerTargets: LegalIssueDetectionResult["answerTargets"] = [{ text: "cel testowy" }],
  ): DetectLegalIssuesFn {
    const detection: LegalIssueDetectionResult = {
      summary: "Możliwy spór dotyczący wykonania umowy.",
      answerTargets,
      issues,
    };
    return async () => detection;
  }

  it("rejects an empty legalActVersionIds array as a hard safety boundary", async () => {
    if (!db) throw new Error("unreachable");

    await expect(
      investigateLegalProblem({
        problemDescription: "opis problemu",
        legalActVersionIds: [],
        db,
        embedTexts: fakeEmbed,
        detectIssues: detectionWith([
          issueWithQuery({ label: "issue", likelihood: "possible", rationale: "rationale", query: "KEYWORD_ALPHA" }),
        ]),
      }),
    ).rejects.toThrow(LegalIssueInvestigationError);
  });

  it("handles a legitimate zero-issue detection result deterministically: no search attempted, empty result, no exception", async () => {
    const { currentVersion } = await seedFixture();
    if (!db) throw new Error("unreachable");

    let searchAttempted = false;
    const trackingEmbed: EmbedTextsFn = async (texts) => {
      searchAttempted = true;
      return fakeEmbed(texts);
    };

    const result = await investigateLegalProblem({
      problemDescription: "jaka jest dzisiaj pogoda?",
      legalActVersionIds: [currentVersion.id],
      db,
      embedTexts: trackingEmbed,
      detectIssues: detectionWith([], []),
    });

    expect(searchAttempted).toBe(false);
    expect(result.issues).toEqual([]);
    expect(result.answerTargets).toEqual([]);
    expect(result.retrievedProvisions).toEqual([]);
  });

  it.each([
    ["weather question", "jaka jest dzisiaj pogoda w Warszawie?"],
    ["poem request", "napisz mi wiersz o wiośnie"],
    ["arithmetic/non-legal prompt", "ile to jest 2 plus 2?"],
  ])("%s: zero detected issues flows to a safe, empty investigation result", async (_label, problemDescription) => {
    const { currentVersion } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const result = await investigateLegalProblem({
      problemDescription,
      legalActVersionIds: [currentVersion.id],
      db,
      embedTexts: fakeEmbed,
      detectIssues: detectionWith([], []),
    });

    expect(result.issues).toEqual([]);
    expect(result.retrievedProvisions).toEqual([]);
  });

  it("never searches a historical version unless it is explicitly supplied", async () => {
    const { currentVersion, historicalVersion, alpha } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const result = await investigateLegalProblem({
      problemDescription: "opis problemu",
      legalActVersionIds: [currentVersion.id],
      db,
      embedTexts: fakeEmbed,
      detectIssues: detectionWith([
        issueWithQuery({
          label: "nienależyte wykonanie zobowiązania",
          likelihood: "most_likely",
          rationale: "rationale",
          query: "KEYWORD_ALPHA",
        }),
      ]),
    });

    expect(result.retrievedProvisions.every((item) => item.legalActVersionId === currentVersion.id)).toBe(true);
    expect(result.retrievedProvisions.some((item) => item.legalProvisionId === alpha.id)).toBe(true);
    expect(historicalVersion.id).not.toBe(currentVersion.id);
  });

  it("handles multiple plausible issues, multiple queries per issue, cross-issue dedup, and provenance", async () => {
    const { currentVersion, alpha, beta } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const result = await investigateLegalProblem({
      problemDescription: "firma remontowa źle zrobiła remont i nie chce oddać pieniędzy",
      legalActVersionIds: [currentVersion.id],
      // With only 2 documents in this tiny fixture, vector search (which has no
      // similarity floor) would return both for every query; pinning limitPerQuery
      // to 1 keeps each query's contribution deterministic for this test.
      limitPerQuery: 1,
      db,
      embedTexts: fakeEmbed,
      detectIssues: detectionWith(
        [
          issueWithQuery({
            label: "nienależyte wykonanie zobowiązania",
            likelihood: "most_likely",
            rationale: "Opis wskazuje na wadliwe wykonanie usługi.",
            query: "KEYWORD_ALPHA",
            answerTargetIndex: 1,
          }),
          {
            label: "uprawnienia z rękojmi",
            likelihood: "possible",
            rationale: "Charakter umowy może wskazywać na rękojmię.",
            answerTargetIndexes: [2],
            // two queries: one hits its own provision, one overlaps with the first issue's provision
            retrievalQueries: [
              { query: "KEYWORD_BETA", answerTargetIndex: 2 },
              { query: "KEYWORD_ALPHA", answerTargetIndex: 2 },
            ],
          },
        ],
        [{ text: "czy dłużnik odpowiada za nienależyte wykonanie" }, { text: "czy przysługuje rękojmia" }],
      ),
    });

    expect(result.issues).toHaveLength(2);
    expect(result.issues.map((issue) => issue.likelihood)).toEqual(["most_likely", "possible"]);

    // multiple retrieval queries per issue preserved (both under the possible-issue cap of
    // 1-per-target, since they target DIFFERENT answerTargetIndex values here: both are
    // tagged answerTargetIndex 2 in this fixture on purpose, so only the first survives the cap)
    expect(result.issues[1].retrievalQueries).toEqual([{ query: "KEYWORD_BETA", answerTargetIndex: 2 }]);

    // alpha was found only via issue 1 (KEYWORD_ALPHA) — issue 2's KEYWORD_ALPHA query was
    // capped away (possible-issue queries capped at 1 per answerTargetIndex)
    const dedupedIds = result.retrievedProvisions.map((item) => item.legalProvisionId);
    expect(dedupedIds.filter((id) => id === alpha.id)).toHaveLength(1);
    expect(dedupedIds).toContain(beta.id);

    const alphaEntry = result.retrievedProvisions.find((item) => item.legalProvisionId === alpha.id);
    expect(alphaEntry?.foundBy).toHaveLength(1);
    expect(alphaEntry?.foundBy[0].issueLabel).toBe("nienależyte wykonanie zobowiązania");
    expect(alphaEntry?.foundBy[0].answerTargetIndex).toBe(1);
    expect(alphaEntry?.foundBy.every((entry) => entry.retrievalQuery === "KEYWORD_ALPHA")).toBe(true);

    // provenance is retained per issue too (which provisions each issue's own retrieval surfaced)
    expect(result.issues[0].retrievedProvisionIds).toContain(alpha.id);
    expect(result.issues[1].retrievedProvisionIds).toEqual([beta.id]);

    // authority/version metadata preserved on retrieved evidence
    expect(alphaEntry?.authorityClass).toBe("authoritative");
    expect(alphaEntry?.currentnessStatus).toBe("unproven");
    expect(alphaEntry?.versionKind).toBe("promulgated");
  });

  it("preserves an unsupported hypothesis with zero retrieved results rather than hiding it", async () => {
    // Target a version that was never indexed: lexical/vector search over it can only
    // ever return zero candidates, so this deterministically models an issue hypothesis
    // genuinely unsupported by retrieval — not an artifact of ranking within a small corpus.
    const { unindexedVersion } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const result = await investigateLegalProblem({
      problemDescription: "opis problemu",
      legalActVersionIds: [unindexedVersion.id],
      db,
      embedTexts: fakeEmbed,
      detectIssues: detectionWith([
        issueWithQuery({
          label: "zagadnienie bez pokrycia w tym korpusie",
          likelihood: "needs_more_information",
          rationale: "Brak wystarczających informacji.",
          query: "KEYWORD_NONEXISTENT_TOPIC",
        }),
      ]),
    });

    expect(result.issues).toHaveLength(1);
    // needs_more_information issues never spend retrieval budget (Phase 3): zero queries run.
    expect(result.issues[0].retrievalQueries).toEqual([]);
    expect(result.issues[0].retrievedProvisionIds).toEqual([]);
    expect(result.retrievedProvisions).toEqual([]);
  });

  it("carries a clarification question through when the model asks one", async () => {
    const { currentVersion } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const detection: LegalIssueDetectionResult = {
      summary: "Summary",
      answerTargets: [{ text: "cel" }],
      issues: [
        issueWithQuery({ label: "issue", likelihood: "needs_more_information", rationale: "rationale", query: "KEYWORD_ALPHA" }),
      ],
      clarificationQuestion: "Czy strony zawarły umowę pisemną?",
    };

    const result = await investigateLegalProblem({
      problemDescription: "opis problemu",
      legalActVersionIds: [currentVersion.id],
      db,
      embedTexts: fakeEmbed,
      detectIssues: async () => detection,
    });

    expect(result.clarificationQuestion).toBe("Czy strony zawarły umowę pisemną?");
  });

  it("never generates a final AI answer — the result is retrieval evidence only", async () => {
    const { currentVersion } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const result = await investigateLegalProblem({
      problemDescription: "opis problemu",
      legalActVersionIds: [currentVersion.id],
      db,
      embedTexts: fakeEmbed,
      detectIssues: detectionWith([
        issueWithQuery({ label: "issue", likelihood: "possible", rationale: "rationale", query: "KEYWORD_ALPHA" }),
      ]),
    });

    const keys = Object.keys(result);
    for (const forbidden of ["answer", "finalAnswer", "advice", "legalAdvice", "conclusion"]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(keys.sort()).toEqual(
      [
        "problemDescription",
        "legalActVersionIds",
        "summary",
        "clarificationQuestion",
        "answerTargets",
        "issues",
        "retrievedProvisions",
      ].sort(),
    );
  });

  it("may honestly find zero supporting provisions against an INDEXED corpus when all semantic matches are too weak", async () => {
    // Unlike the "unindexed version" case above, this corpus has real indexed content —
    // the quality guard, not an empty index, is what produces the true negative here.
    const { currentVersion } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const weakEmbed: EmbedTextsFn = async (texts) =>
      texts.map(() => {
        const vector = new Array<number>(DIMENSIONS).fill(0);
        vector[0] = 0.1; // weak similarity to alpha's e0 embedding, well below the 0.35 default
        vector[1000] = Math.sqrt(1 - 0.1 * 0.1);
        return vector;
      });

    const result = await investigateLegalProblem({
      problemDescription: "opis problemu bez pokrycia w tym korpusie",
      legalActVersionIds: [currentVersion.id],
      db,
      embedTexts: weakEmbed,
      detectIssues: detectionWith([
        issueWithQuery({
          label: "zagadnienie o słabym dopasowaniu semantycznym",
          likelihood: "possible",
          rationale: "rationale",
          query: "zapytanie bez pokrycia leksykalnego",
        }),
      ]),
    });

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].retrievedProvisionIds).toEqual([]);
    expect(result.retrievedProvisions).toEqual([]);
  });
});

describe("capRetrievalQueries", () => {
  it("drops all queries for a needs_more_information issue", () => {
    const [result] = capRetrievalQueries([
      issueWithQuery({ label: "x", likelihood: "needs_more_information", rationale: "r", query: "q1" }),
    ]);
    expect(result.retrievalQueries).toEqual([]);
  });

  it("caps a most_likely issue at 3 queries per distinct answerTargetIndex", () => {
    const [result] = capRetrievalQueries([
      {
        label: "x",
        likelihood: "most_likely",
        rationale: "r",
        answerTargetIndexes: [1],
        retrievalQueries: [
          { query: "q1", answerTargetIndex: 1 },
          { query: "q2", answerTargetIndex: 1 },
          { query: "q3", answerTargetIndex: 1 },
          { query: "q4", answerTargetIndex: 1 },
        ],
      },
    ]);
    expect(result.retrievalQueries).toEqual([
      { query: "q1", answerTargetIndex: 1 },
      { query: "q2", answerTargetIndex: 1 },
      { query: "q3", answerTargetIndex: 1 },
    ]);
  });

  it("caps a possible issue at 1 query per distinct answerTargetIndex, independently per target", () => {
    const [result] = capRetrievalQueries([
      {
        label: "x",
        likelihood: "possible",
        rationale: "r",
        answerTargetIndexes: [1, 2],
        retrievalQueries: [
          { query: "q1-target1", answerTargetIndex: 1 },
          { query: "q2-target1", answerTargetIndex: 1 },
          { query: "q1-target2", answerTargetIndex: 2 },
        ],
      },
    ]);
    expect(result.retrievalQueries).toEqual([
      { query: "q1-target1", answerTargetIndex: 1 },
      { query: "q1-target2", answerTargetIndex: 2 },
    ]);
  });

  it("is a pure function that never mutates its input", () => {
    const input: LegalIssueHypothesis[] = [
      {
        label: "x",
        likelihood: "possible",
        rationale: "r",
        answerTargetIndexes: [1],
        retrievalQueries: [
          { query: "q1", answerTargetIndex: 1 },
          { query: "q2", answerTargetIndex: 1 },
        ],
      },
    ];
    const snapshot = JSON.parse(JSON.stringify(input));
    capRetrievalQueries(input);
    expect(input).toEqual(snapshot);
  });
});
