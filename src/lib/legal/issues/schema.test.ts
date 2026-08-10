import { describe, expect, it } from "vitest";

import { legalIssueDetectionResultSchema } from "./schema";

const validAnswerTargets = [{ text: "jakie prawa ma producent bazy danych" }];

const validIssue = {
  label: "nienależyte wykonanie zobowiązania",
  likelihood: "most_likely" as const,
  rationale: "Opis wskazuje na wadliwe wykonanie usługi remontowej.",
  answerTargetIndexes: [1],
  retrievalQueries: [
    { query: "nienależyte wykonanie zobowiązania", answerTargetIndex: 1 },
    { query: "art. 471 kc", answerTargetIndex: 1 },
  ],
};

describe("legalIssueDetectionResultSchema", () => {
  it("accepts a result with multiple plausible issues, qualitative likelihoods, and answer targets", () => {
    const result = legalIssueDetectionResultSchema.safeParse({
      summary: "Możliwy spór dotyczący jakości usługi remontowej i zwrotu pieniędzy.",
      answerTargets: [{ text: "czy wykonawca odpowiada za wady" }, { text: "czy można odstąpić od umowy" }],
      issues: [
        { ...validIssue, answerTargetIndexes: [1], retrievalQueries: [{ query: "nienależyte wykonanie", answerTargetIndex: 1 }] },
        {
          label: "uprawnienia z rękojmi / odpowiedzialność za wady",
          likelihood: "possible",
          rationale: "Charakter umowy może wskazywać na odpowiedzialność za wady.",
          answerTargetIndexes: [1],
          retrievalQueries: [{ query: "rękojmia za wady", answerTargetIndex: 1 }],
        },
        {
          label: "odstąpienie od umowy",
          likelihood: "needs_more_information",
          rationale: "Zależy od tego, czy strona wzywała do usunięcia wad.",
          answerTargetIndexes: [2],
          retrievalQueries: [{ query: "odstąpienie od umowy o dzieło", answerTargetIndex: 2 }],
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.issues).toHaveLength(3);
      expect(result.data.answerTargets).toHaveLength(2);
      expect(result.data.issues.map((issue) => issue.likelihood)).toEqual([
        "most_likely",
        "possible",
        "needs_more_information",
      ]);
    }
  });

  it("accepts an optional clarification question", () => {
    const result = legalIssueDetectionResultSchema.safeParse({
      summary: "Summary",
      answerTargets: validAnswerTargets,
      issues: [validIssue],
      clarificationQuestion: "Czy strony zawarły umowę pisemną?",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty issue list and empty answer targets as a legitimate zero-legal-issue result", () => {
    const result = legalIssueDetectionResultSchema.safeParse({ summary: "Summary", answerTargets: [], issues: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.issues).toEqual([]);
      expect(result.data.answerTargets).toEqual([]);
    }
  });

  it("rejects a numeric confidence value in place of a qualitative likelihood", () => {
    const result = legalIssueDetectionResultSchema.safeParse({
      summary: "Summary",
      answerTargets: validAnswerTargets,
      issues: [{ ...validIssue, likelihood: 0.8 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unrecognized likelihood value", () => {
    const result = legalIssueDetectionResultSchema.safeParse({
      summary: "Summary",
      answerTargets: validAnswerTargets,
      issues: [{ ...validIssue, likelihood: "certain" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an issue with no retrieval queries", () => {
    const result = legalIssueDetectionResultSchema.safeParse({
      summary: "Summary",
      answerTargets: validAnswerTargets,
      issues: [{ ...validIssue, retrievalQueries: [] }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an issue with no answerTargetIndexes", () => {
    const result = legalIssueDetectionResultSchema.safeParse({
      summary: "Summary",
      answerTargets: validAnswerTargets,
      issues: [{ ...validIssue, answerTargetIndexes: [] }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects issues present while answerTargets is empty", () => {
    const result = legalIssueDetectionResultSchema.safeParse({
      summary: "Summary",
      answerTargets: [],
      issues: [validIssue],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an answerTargetIndex that is out of range of answerTargets", () => {
    const result = legalIssueDetectionResultSchema.safeParse({
      summary: "Summary",
      answerTargets: validAnswerTargets,
      issues: [{ ...validIssue, answerTargetIndexes: [2] }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a retrievalQuery.answerTargetIndex that is out of range of answerTargets", () => {
    const result = legalIssueDetectionResultSchema.safeParse({
      summary: "Summary",
      answerTargets: validAnswerTargets,
      issues: [{ ...validIssue, retrievalQueries: [{ query: "x", answerTargetIndex: 5 }] }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 4 answerTargets", () => {
    const result = legalIssueDetectionResultSchema.safeParse({
      summary: "Summary",
      answerTargets: [{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }, { text: "e" }],
      issues: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed/incomplete payloads", () => {
    expect(legalIssueDetectionResultSchema.safeParse(null).success).toBe(false);
    expect(legalIssueDetectionResultSchema.safeParse({}).success).toBe(false);
    expect(legalIssueDetectionResultSchema.safeParse({ summary: "x" }).success).toBe(false);
    expect(legalIssueDetectionResultSchema.safeParse("not json").success).toBe(false);
  });
});
