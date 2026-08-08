import { describe, expect, it } from "vitest";

import { legalIssueDetectionResultSchema } from "./schema";

const validIssue = {
  label: "nienależyte wykonanie zobowiązania",
  likelihood: "most_likely" as const,
  rationale: "Opis wskazuje na wadliwe wykonanie usługi remontowej.",
  retrievalQueries: ["nienależyte wykonanie zobowiązania", "art. 471 kc"],
};

describe("legalIssueDetectionResultSchema", () => {
  it("accepts a result with multiple plausible issues and qualitative likelihoods", () => {
    const result = legalIssueDetectionResultSchema.safeParse({
      summary: "Możliwy spór dotyczący jakości usługi remontowej i zwrotu pieniędzy.",
      issues: [
        validIssue,
        {
          label: "uprawnienia z rękojmi / odpowiedzialność za wady",
          likelihood: "possible",
          rationale: "Charakter umowy może wskazywać na odpowiedzialność za wady.",
          retrievalQueries: ["rękojmia za wady", "odpowiedzialność za wady dzieła"],
        },
        {
          label: "odstąpienie od umowy",
          likelihood: "needs_more_information",
          rationale: "Zależy od tego, czy strona wzywała do usunięcia wad.",
          retrievalQueries: ["odstąpienie od umowy o dzieło"],
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.issues).toHaveLength(3);
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
      issues: [validIssue],
      clarificationQuestion: "Czy strony zawarły umowę pisemną?",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty issue list", () => {
    const result = legalIssueDetectionResultSchema.safeParse({ summary: "Summary", issues: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a numeric confidence value in place of a qualitative likelihood", () => {
    const result = legalIssueDetectionResultSchema.safeParse({
      summary: "Summary",
      issues: [{ ...validIssue, likelihood: 0.8 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unrecognized likelihood value", () => {
    const result = legalIssueDetectionResultSchema.safeParse({
      summary: "Summary",
      issues: [{ ...validIssue, likelihood: "certain" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an issue with no retrieval queries", () => {
    const result = legalIssueDetectionResultSchema.safeParse({
      summary: "Summary",
      issues: [{ ...validIssue, retrievalQueries: [] }],
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
