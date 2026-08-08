import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { legalActVersions, legalActs, legalProvisions } from "../../../db/schema";
import { createTestDatabase } from "../../test-support/test-db";
import type { EmbedTextsFn } from "../search/embeddings";
import { indexLegalSearchDocuments } from "../search/indexing";
import type { DetectLegalIssuesFn } from "./detect";
import { investigateLegalProblem, LegalIssueInvestigationError } from "./investigate";
import type { LegalIssueDetectionResult } from "./schema";

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

  function detectionWith(issues: LegalIssueDetectionResult["issues"]): DetectLegalIssuesFn {
    const detection: LegalIssueDetectionResult = {
      summary: "Możliwy spór dotyczący wykonania umowy.",
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
          {
            label: "issue",
            likelihood: "possible",
            rationale: "rationale",
            retrievalQueries: ["KEYWORD_ALPHA"],
          },
        ]),
      }),
    ).rejects.toThrow(LegalIssueInvestigationError);
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
        {
          label: "nienależyte wykonanie zobowiązania",
          likelihood: "most_likely",
          rationale: "rationale",
          retrievalQueries: ["KEYWORD_ALPHA"],
        },
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
      detectIssues: detectionWith([
        {
          label: "nienależyte wykonanie zobowiązania",
          likelihood: "most_likely",
          rationale: "Opis wskazuje na wadliwe wykonanie usługi.",
          retrievalQueries: ["KEYWORD_ALPHA"],
        },
        {
          label: "uprawnienia z rękojmi",
          likelihood: "possible",
          rationale: "Charakter umowy może wskazywać na rękojmię.",
          // two queries: one hits its own provision, one overlaps with the first issue's provision
          retrievalQueries: ["KEYWORD_BETA", "KEYWORD_ALPHA"],
        },
      ]),
    });

    expect(result.issues).toHaveLength(2);
    expect(result.issues.map((issue) => issue.likelihood)).toEqual(["most_likely", "possible"]);

    // multiple retrieval queries per issue preserved
    expect(result.issues[1].retrievalQueries).toEqual(["KEYWORD_BETA", "KEYWORD_ALPHA"]);

    // cross-issue dedup: alpha was found via issue 1 (KEYWORD_ALPHA) and issue 2 (KEYWORD_ALPHA) -> appears once
    const dedupedIds = result.retrievedProvisions.map((item) => item.legalProvisionId);
    expect(dedupedIds.filter((id) => id === alpha.id)).toHaveLength(1);
    expect(dedupedIds).toContain(beta.id);

    const alphaEntry = result.retrievedProvisions.find((item) => item.legalProvisionId === alpha.id);
    expect(alphaEntry?.foundBy).toHaveLength(2);
    expect(alphaEntry?.foundBy.map((entry) => entry.issueLabel).sort()).toEqual(
      ["nienależyte wykonanie zobowiązania", "uprawnienia z rękojmi"].sort(),
    );
    expect(alphaEntry?.foundBy.every((entry) => entry.retrievalQuery === "KEYWORD_ALPHA")).toBe(true);

    // provenance is retained per issue too (which provisions each issue's own retrieval surfaced)
    expect(result.issues[0].retrievedProvisionIds).toContain(alpha.id);
    expect(result.issues[1].retrievedProvisionIds).toEqual(expect.arrayContaining([beta.id, alpha.id]));

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
        {
          label: "zagadnienie bez pokrycia w tym korpusie",
          likelihood: "needs_more_information",
          rationale: "Brak wystarczających informacji.",
          retrievalQueries: ["KEYWORD_NONEXISTENT_TOPIC"],
        },
      ]),
    });

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].retrievedProvisionIds).toEqual([]);
    expect(result.retrievedProvisions).toEqual([]);
  });

  it("carries a clarification question through when the model asks one", async () => {
    const { currentVersion } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const detection: LegalIssueDetectionResult = {
      summary: "Summary",
      issues: [
        {
          label: "issue",
          likelihood: "needs_more_information",
          rationale: "rationale",
          retrievalQueries: ["KEYWORD_ALPHA"],
        },
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
        {
          label: "issue",
          likelihood: "possible",
          rationale: "rationale",
          retrievalQueries: ["KEYWORD_ALPHA"],
        },
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
        "issues",
        "retrievedProvisions",
      ].sort(),
    );
  });
});
