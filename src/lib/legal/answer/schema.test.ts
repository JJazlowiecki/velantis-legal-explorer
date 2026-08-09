import { describe, expect, it } from "vitest";

import { buildRawFinalAnswerResponseSchema, rawFinalAnswerResponseSchema } from "./schema";

const validPayload = {
  answer: "Zgodnie z art. 471 dłużnik odpowiada za nienależyte wykonanie zobowiązania.",
  conclusions: [
    {
      statement: "Dłużnik może ponosić odpowiedzialność odszkodowawczą za nienależyte wykonanie umowy.",
      support: [{ sourceId: "SOURCE_1" }],
    },
  ],
  alternativePaths: [],
  uncertainties: [],
};

describe("rawFinalAnswerResponseSchema", () => {
  it("accepts a well-formed grounded response", () => {
    expect(rawFinalAnswerResponseSchema.safeParse(validPayload).success).toBe(true);
  });

  it("accepts multiple conclusions backed by different sources", () => {
    const result = rawFinalAnswerResponseSchema.safeParse({
      ...validPayload,
      conclusions: [
        { statement: "Teza pierwsza.", support: [{ sourceId: "SOURCE_1" }] },
        { statement: "Teza druga.", support: [{ sourceId: "SOURCE_2" }, { sourceId: "SOURCE_3" }] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts alternative paths with empty support (unsupported hypothesis, honestly documented)", () => {
    const result = rawFinalAnswerResponseSchema.safeParse({
      ...validPayload,
      alternativePaths: [
        { issueLabel: "odstąpienie od umowy", explanation: "Brak przepisów potwierdzających.", support: [] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a conclusion with no support — unsupported conclusions are never valid", () => {
    const result = rawFinalAnswerResponseSchema.safeParse({
      ...validPayload,
      conclusions: [{ statement: "Twierdzenie bez źródła.", support: [] }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts an optional clarification question", () => {
    const result = rawFinalAnswerResponseSchema.safeParse({
      ...validPayload,
      clarificationQuestion: "Czy umowa była zawarta na piśmie?",
    });
    expect(result.success).toBe(true);
  });

  it("rejects malformed/incomplete payloads", () => {
    expect(rawFinalAnswerResponseSchema.safeParse(null).success).toBe(false);
    expect(rawFinalAnswerResponseSchema.safeParse({}).success).toBe(false);
    expect(rawFinalAnswerResponseSchema.safeParse("not json").success).toBe(false);
  });
});

describe("buildRawFinalAnswerResponseSchema (citation integrity)", () => {
  it("accepts a response that references only supplied source ids", () => {
    const schema = buildRawFinalAnswerResponseSchema(new Set(["SOURCE_1"]));
    expect(schema.safeParse(validPayload).success).toBe(true);
  });

  it("rejects a conclusion referencing an unknown/fabricated SOURCE_X", () => {
    const schema = buildRawFinalAnswerResponseSchema(new Set(["SOURCE_1"]));
    const result = schema.safeParse({
      ...validPayload,
      conclusions: [{ statement: "Twierdzenie.", support: [{ sourceId: "SOURCE_99" }] }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an alternative path referencing an unknown/fabricated SOURCE_X", () => {
    const schema = buildRawFinalAnswerResponseSchema(new Set(["SOURCE_1"]));
    const result = schema.safeParse({
      ...validPayload,
      alternativePaths: [{ issueLabel: "issue", explanation: "explanation", support: [{ sourceId: "SOURCE_1000" }] }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a made-up non-numbered source id", () => {
    const schema = buildRawFinalAnswerResponseSchema(new Set(["SOURCE_1", "SOURCE_2"]));
    const result = schema.safeParse({
      ...validPayload,
      conclusions: [{ statement: "Twierdzenie.", support: [{ sourceId: "art. 471 kc" }] }],
    });
    expect(result.success).toBe(false);
  });
});
