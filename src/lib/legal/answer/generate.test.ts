import { describe, expect, it, vi } from "vitest";

import { FinalAnswerGenerationError, formatSourceForPrompt, generateFinalAnswer } from "./generate";
import type { PackedSource } from "./packing";

function chatResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function withContent(content: unknown): Response {
  return chatResponse(200, {
    choices: [{ message: { content: JSON.stringify(content) } }],
  });
}

const source: PackedSource = {
  sourceId: "SOURCE_1",
  legalProvisionId: "p1",
  legalActVersionId: "v1",
  legalActId: "a1",
  actTitle: "Ustawa testowa",
  citationLabel: "art. 471",
  text: "Art. 471. Dłużnik obowiązany jest do naprawienia szkody.",
  hierarchy: ["Dział II"],
  versionKind: "promulgated",
  authorityClass: "authoritative",
  currentnessStatus: "unproven",
  provenCurrentAsOf: null,
  sourceExpressionId: "ogl",
  reservedForAnswerTargetIndexes: [],
};

const baseInput = {
  problemDescription: "opis problemu",
  issues: [{ label: "issue", likelihood: "possible" as const, rationale: "rationale" }],
  sources: [source],
};

const validPayload = {
  answer: "Zgodnie z art. 471 dłużnik odpowiada za nienależyte wykonanie.",
  conclusions: [
    { statement: "Dłużnik może odpowiadać odszkodowawczo.", support: [{ sourceId: "SOURCE_1" }] },
  ],
  alternativePaths: [],
  uncertainties: [],
};

describe("generateFinalAnswer", () => {
  it("throws a CONFIG error and makes no request when there are zero sources", async () => {
    const fetchImpl = vi.fn();
    await expect(
      generateFinalAnswer({ ...baseInput, sources: [] }, { apiKey: "k", fetchImpl }),
    ).rejects.toMatchObject({ code: "CONFIG" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws a CONFIG error when no API key is available", async () => {
    const fetchImpl = vi.fn();
    await expect(
      generateFinalAnswer(baseInput, { apiKey: undefined, fetchImpl }),
    ).rejects.toMatchObject({ code: "CONFIG" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("parses a valid grounded response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent(validPayload));
    const result = await generateFinalAnswer(baseInput, { apiKey: "test-key", fetchImpl });

    expect(result.conclusions).toHaveLength(1);
    expect(result.conclusions[0].support[0].sourceId).toBe("SOURCE_1");
  });

  it("never logs the API key in the request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent(validPayload));
    await generateFinalAnswer(baseInput, { apiKey: "super-secret-key", fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer super-secret-key");
    expect(String(init.body)).not.toContain("super-secret-key");
  });

  it("includes only supplied source ids in the prompt payload sent to the model", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent(validPayload));
    await generateFinalAnswer(baseInput, { apiKey: "test-key", fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain("SOURCE_1");
    expect(String(init.body)).toContain("art. 471");
  });

  it("A: uses strict json_schema Structured Outputs constraining support.sourceId to exactly the supplied SOURCE_X ids", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent(validPayload));
    const twoSources: PackedSource[] = [
      source,
      { ...source, sourceId: "SOURCE_2", legalProvisionId: "p2", citationLabel: "art. 556" },
    ];
    await generateFinalAnswer({ ...baseInput, sources: twoSources }, { apiKey: "test-key", fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);

    const schema = body.response_format.json_schema.schema;
    const sourceEnum = schema.properties.conclusions.items.properties.support.items.properties.sourceId.enum;
    expect(sourceEnum).toEqual(["SOURCE_1", "SOURCE_2"]);
    expect(sourceEnum).not.toContain("SOURCE_171");
    expect(sourceEnum).not.toContain("SOURCE_99");

    const altPathSourceEnum =
      schema.properties.alternativePaths.items.properties.support.items.properties.sourceId.enum;
    expect(altPathSourceEnum).toEqual(["SOURCE_1", "SOURCE_2"]);
  });

  it("B: the generated schema marks every property as required and forbids additional properties", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent(validPayload));
    await generateFinalAnswer(baseInput, { apiKey: "test-key", fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const schema = JSON.parse(String(init.body)).response_format.json_schema.schema;

    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["answer", "conclusions", "alternativePaths", "uncertainties", "clarificationQuestion"]);
    expect(schema.properties.conclusions.items.additionalProperties).toBe(false);
    expect(schema.properties.conclusions.items.required).toEqual(["statement", "support", "answerTargetIndex"]);
  });

  it("constrains answerTargetIndex to exactly 1..N when answerTargets are supplied, and to null-only when none are", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(withContent(validPayload))
      .mockResolvedValueOnce(withContent(validPayload));
    await generateFinalAnswer(
      {
        ...baseInput,
        answerTargets: [
          { index: 1, text: "target one" },
          { index: 2, text: "target two" },
        ],
      },
      { apiKey: "test-key", fetchImpl },
    );
    const schemaWithTargets = JSON.parse(String(fetchImpl.mock.calls[0][1].body)).response_format.json_schema.schema;
    const answerTargetIndexSchema = schemaWithTargets.properties.conclusions.items.properties.answerTargetIndex;
    expect(answerTargetIndexSchema.anyOf).toEqual([{ type: "integer", enum: [1, 2] }, { type: "null" }]);

    await generateFinalAnswer(baseInput, { apiKey: "test-key", fetchImpl });
    const schemaWithoutTargets = JSON.parse(String(fetchImpl.mock.calls[1][1].body)).response_format.json_schema.schema;
    expect(schemaWithoutTargets.properties.conclusions.items.properties.answerTargetIndex).toEqual({ type: "null" });
  });

  it("rejects a conclusion whose answerTargetIndex is out of range of the supplied answerTargets", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      withContent({
        ...validPayload,
        conclusions: [{ ...validPayload.conclusions[0], answerTargetIndex: 5 }],
      }),
    );

    await expect(
      generateFinalAnswer(
        { ...baseInput, answerTargets: [{ index: 1, text: "only target" }] },
        { apiKey: "test-key", fetchImpl, maxRetries: 0 },
      ),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("accepts a conclusion with a null answerTargetIndex (general claim, not tied to one target)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      withContent({
        ...validPayload,
        conclusions: [{ ...validPayload.conclusions[0], answerTargetIndex: null }],
      }),
    );

    const result = await generateFinalAnswer(
      { ...baseInput, answerTargets: [{ index: 1, text: "only target" }] },
      { apiKey: "test-key", fetchImpl },
    );
    expect(result.conclusions[0].answerTargetIndex).toBeNull();
  });

  it("includes the answerTargets block in the user message, in order, ahead of issue hypotheses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent(validPayload));
    await generateFinalAnswer(
      {
        ...baseInput,
        answerTargets: [
          { index: 1, text: "jakie prawa ma producent" },
          { index: 2, text: "przed czym chroni ustawa" },
        ],
      },
      { apiKey: "test-key", fetchImpl },
    );

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    const userMessage = body.messages.find((m: { role: string }) => m.role === "user").content as string;

    expect(userMessage).toContain("jakie prawa ma producent");
    expect(userMessage).toContain("przed czym chroni ustawa");
    expect(userMessage.indexOf("CELE ODPOWIEDZI")).toBeLessThan(userMessage.indexOf("HIPOTEZY PRAWNE"));
  });

  it("H: fails closed when the model refuses to produce a structured response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      chatResponse(200, { choices: [{ message: { content: null, refusal: "cannot comply" }, finish_reason: "stop" }] }),
    );

    await expect(
      generateFinalAnswer(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("H: fails closed when the response is truncated (finish_reason=length) instead of completing normally", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      chatResponse(200, {
        choices: [{ message: { content: JSON.stringify(validPayload) }, finish_reason: "length" }],
      }),
    );

    await expect(
      generateFinalAnswer(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a response referencing an unknown/fabricated SOURCE_X", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      withContent({
        ...validPayload,
        conclusions: [{ statement: "Twierdzenie.", support: [{ sourceId: "SOURCE_99" }] }],
      }),
    );

    await expect(
      generateFinalAnswer(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a conclusion with no support", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      withContent({ ...validPayload, conclusions: [{ statement: "Twierdzenie bez źródła.", support: [] }] }),
    );

    await expect(
      generateFinalAnswer(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("tolerates an empty-string clarificationQuestion instead of rejecting an otherwise valid response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent({ ...validPayload, clarificationQuestion: "" }));
    const result = await generateFinalAnswer(baseInput, { apiKey: "test-key", fetchImpl });
    expect(result.clarificationQuestion).toBeUndefined();
  });

  it("rejects malformed JSON returned by the model", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(chatResponse(200, { choices: [{ message: { content: "not valid json at all" } }] }));

    await expect(
      generateFinalAnswer(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("fails clearly on authentication errors without retrying", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(401, { error: "invalid api key" }));

    await expect(generateFinalAnswer(baseInput, { apiKey: "bad-key", fetchImpl })).rejects.toMatchObject({
      code: "HTTP_ERROR",
      status: 401,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a bounded number of times on transient 5xx failures then succeeds", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(chatResponse(503, { error: "unavailable" }))
        .mockResolvedValueOnce(withContent(validPayload));

      const resultPromise = generateFinalAnswer(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 2 });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.conclusions).toHaveLength(1);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never retries indefinitely", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn().mockResolvedValue(chatResponse(503, { error: "unavailable" }));
      const resultPromise = generateFinalAnswer(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 1 });
      const assertion = expect(resultPromise).rejects.toMatchObject({ code: "HTTP_ERROR", status: 503 });

      await vi.runAllTimersAsync();
      await assertion;
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("FinalAnswerGenerationError", () => {
  it("carries a code and optional status", () => {
    const error = new FinalAnswerGenerationError("boom", "HTTP_ERROR", 500);
    expect(error.code).toBe("HTTP_ERROR");
    expect(error.status).toBe(500);
    expect(error.name).toBe("FinalAnswerGenerationError");
  });
});

describe("formatSourceForPrompt currentness representation", () => {
  it("A: a run-scoped proven-current source is presented with its exact proof date and no generic 'unproven' text", () => {
    const provenSource: PackedSource = { ...source, currentnessStatus: "unproven", provenCurrentAsOf: "2026-08-09" };
    const formatted = formatSourceForPrompt(provenSource);

    expect(formatted).toContain("aktualność potwierdzona na dzień 2026-08-09");
    expect(formatted).not.toContain("aktualność: unproven");
  });

  it("B: a source with no run-scoped proof keeps the existing conservative 'unproven' representation", () => {
    const unprovenSource: PackedSource = { ...source, currentnessStatus: "unproven", provenCurrentAsOf: null };
    const formatted = formatSourceForPrompt(unprovenSource);

    expect(formatted).toContain("aktualność: unproven");
    expect(formatted).not.toContain("aktualność potwierdzona");
  });

  it("C: the immutable currentnessStatus field never overrides run-scoped proof when both are present", () => {
    // currentnessStatus stays "unproven" by design even for a proven-current source (it is
    // never mutated anywhere) — provenCurrentAsOf alone must decide the prompt representation.
    const provenSource: PackedSource = { ...source, currentnessStatus: "unproven", provenCurrentAsOf: "2026-08-09" };
    const formatted = formatSourceForPrompt(provenSource);

    expect(formatted).toContain("aktualność potwierdzona na dzień 2026-08-09");
  });

  it("D: the proof date is bounded — never rendered as unconditionally/forever current or as a different date", () => {
    const provenSource: PackedSource = { ...source, provenCurrentAsOf: "2026-08-09" };
    const formatted = formatSourceForPrompt(provenSource);

    expect(formatted).toContain("2026-08-09");
    expect(formatted).not.toMatch(/obowiązując[ay] (bezterminowo|zawsze|na zawsze)/i);
    expect(formatted).not.toContain("2026-01-01");
    expect(formatted).not.toContain("2027-08-09");
  });

  it("end-to-end: generateFinalAnswer sends the proven-current representation to the model, not the raw currentnessStatus", async () => {
    const provenSource: PackedSource = { ...source, currentnessStatus: "unproven", provenCurrentAsOf: "2026-08-09" };
    const fetchImpl = vi.fn().mockResolvedValue(withContent(validPayload));
    await generateFinalAnswer({ ...baseInput, sources: [provenSource] }, { apiKey: "test-key", fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    const userMessage = body.messages.find((m: { role: string }) => m.role === "user").content as string;
    const sourcesSection = userMessage.slice(userMessage.indexOf("ŹRÓDŁA:"));

    // Only the ŹRÓDŁA: section is asserted here — the system prompt's own instructional text
    // legitimately mentions the literal string "aktualność: unproven" generically (to explain
    // the unproven case), which is irrelevant to what THIS source's own metadata line says.
    expect(sourcesSection).toContain("aktualność potwierdzona na dzień 2026-08-09");
    expect(sourcesSection).not.toContain("aktualność: unproven");
  });
});
