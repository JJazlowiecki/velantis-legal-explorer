import { describe, expect, it } from "vitest";

import { explorerHistoryCorpusVersionIdsSchema, explorerHistorySnapshotSchema } from "./snapshot";

const validSnapshot = {
  status: "answered",
  answer: "Odpowiedź.",
  conclusions: [{ statement: "Teza.", citationLabels: ["art. 471"] }],
  alternativePaths: [],
  uncertainties: ["Aktualność nie została potwierdzona."],
  citedSources: [
    { actTitle: "Ustawa testowa", citationLabel: "art. 471", text: "Treść.", isNonAuthoritative: false, isCurrentnessUnproven: true },
  ],
  clarificationQuestion: null,
};

describe("explorerHistorySnapshotSchema", () => {
  it("accepts a well-formed answered snapshot", () => {
    expect(explorerHistorySnapshotSchema.safeParse(validSnapshot).success).toBe(true);
  });

  it("accepts a well-formed insufficient_evidence snapshot with empty conclusions/sources", () => {
    const result = explorerHistorySnapshotSchema.safeParse({
      ...validSnapshot,
      status: "insufficient_evidence",
      conclusions: [],
      citedSources: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown status value", () => {
    expect(explorerHistorySnapshotSchema.safeParse({ ...validSnapshot, status: "error" }).success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const withoutAnswer: Record<string, unknown> = { ...validSnapshot };
    delete withoutAnswer.answer;
    expect(explorerHistorySnapshotSchema.safeParse(withoutAnswer).success).toBe(false);
  });

  it("rejects a wrong type for a nested field", () => {
    expect(
      explorerHistorySnapshotSchema.safeParse({
        ...validSnapshot,
        citedSources: [{ ...validSnapshot.citedSources[0], isNonAuthoritative: "yes" }],
      }).success,
    ).toBe(false);
  });

  it("rejects completely malformed/unrelated JSON", () => {
    expect(explorerHistorySnapshotSchema.safeParse({ foo: "bar" }).success).toBe(false);
    expect(explorerHistorySnapshotSchema.safeParse(null).success).toBe(false);
    expect(explorerHistorySnapshotSchema.safeParse("not an object").success).toBe(false);
  });

  it("accepts a non-null clarificationQuestion", () => {
    expect(explorerHistorySnapshotSchema.safeParse({ ...validSnapshot, clarificationQuestion: "Czy masz umowę?" }).success).toBe(true);
  });
});

describe("explorerHistoryCorpusVersionIdsSchema", () => {
  it("accepts an array of UUIDs", () => {
    expect(explorerHistoryCorpusVersionIdsSchema.safeParse(["572d313e-ae03-4207-97c6-38e2e5088617"]).success).toBe(true);
  });

  it("rejects non-UUID strings", () => {
    expect(explorerHistoryCorpusVersionIdsSchema.safeParse(["not-a-uuid"]).success).toBe(false);
  });

  it("accepts an empty array", () => {
    expect(explorerHistoryCorpusVersionIdsSchema.safeParse([]).success).toBe(true);
  });
});
