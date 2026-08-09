import { describe, expect, it, vi } from "vitest";

import { FinalAnswerGenerationError, generateFinalAnswer } from "./generate";
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
  sourceExpressionId: "ogl",
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
