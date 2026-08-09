import { describe, expect, it } from "vitest";

import { parseSavedSnapshot, safeParseSavedSnapshot } from "./snapshot";

const validAnswer = {
  query: "sąsiad wyciął moje drzewo",
  status: "answered",
  answer: "Odpowiedź.",
  conclusions: [{ statement: "Teza.", citationLabels: ["art. 471"] }],
  alternativePaths: [],
  uncertainties: ["Aktualność nie została potwierdzona."],
  citedSources: [
    { actTitle: "Ustawa testowa", citationLabel: "art. 471", text: "Treść.", isNonAuthoritative: false, isCurrentnessUnproven: true, provenCurrentAsOf: null },
  ],
  clarificationQuestion: null,
};

const validSearch = { query: "przedawnienie roszczeń z faktury" };

const validProvision = {
  actTitle: "Ustawa testowa",
  citationLabel: "art. 471",
  text: "Treść przepisu.",
  isNonAuthoritative: false,
  isCurrentnessUnproven: true,
  provenCurrentAsOf: null,
};

describe("parseSavedSnapshot", () => {
  it("accepts a well-formed answer snapshot", () => {
    expect(parseSavedSnapshot("answer", validAnswer)).toEqual(validAnswer);
  });

  it("accepts a well-formed search snapshot", () => {
    expect(parseSavedSnapshot("search", validSearch)).toEqual(validSearch);
  });

  it("accepts a well-formed provision snapshot", () => {
    expect(parseSavedSnapshot("provision", validProvision)).toEqual(validProvision);
  });

  it("rejects an answer snapshot missing a required field", () => {
    const withoutAnswer: Record<string, unknown> = { ...validAnswer };
    delete withoutAnswer.answer;
    expect(() => parseSavedSnapshot("answer", withoutAnswer)).toThrow();
  });

  it("rejects a search snapshot with an empty query", () => {
    expect(() => parseSavedSnapshot("search", { query: "" })).toThrow();
  });

  it("rejects a provision snapshot with a wrong field type", () => {
    expect(() => parseSavedSnapshot("provision", { ...validProvision, isNonAuthoritative: "yes" })).toThrow();
  });
});

describe("safeParseSavedSnapshot", () => {
  it("returns success for a valid answer row", () => {
    const result = safeParseSavedSnapshot("answer", validAnswer);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(validAnswer);
  });

  it("fails safe (does not throw) for an unknown kind", () => {
    const result = safeParseSavedSnapshot("act", validAnswer);
    expect(result.success).toBe(false);
  });

  it("fails safe for a malformed persisted snapshot", () => {
    const result = safeParseSavedSnapshot("provision", { totally: "not a valid snapshot" });
    expect(result.success).toBe(false);
  });

  it("fails safe for completely unrelated JSON", () => {
    expect(safeParseSavedSnapshot("answer", null).success).toBe(false);
    expect(safeParseSavedSnapshot("answer", "not an object").success).toBe(false);
    expect(safeParseSavedSnapshot("search", []).success).toBe(false);
  });
});
