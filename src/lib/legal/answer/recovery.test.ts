import { describe, expect, it, vi } from "vitest";

import { RecoveryGenerationError, generateRecoveryConclusions } from "./recovery";
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
};

const baseInput = {
  problemDescription: "opis problemu",
  sources: [source],
};

const validPayload = {
  conclusions: [
    {
      statement: "Dłużnik jest obowiązany do naprawienia szkody.",
      support: [{ sourceId: "SOURCE_1", excerpt: "Dłużnik obowiązany jest do naprawienia szkody." }],
    },
  ],
  uncertainties: [],
};

describe("generateRecoveryConclusions", () => {
  it("throws a CONFIG error and makes no request when there are zero sources", async () => {
    const fetchImpl = vi.fn();
    await expect(
      generateRecoveryConclusions({ ...baseInput, sources: [] }, { apiKey: "k", fetchImpl }),
    ).rejects.toMatchObject({ code: "CONFIG" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws a CONFIG error when no API key is available", async () => {
    const fetchImpl = vi.fn();
    await expect(
      generateRecoveryConclusions(baseInput, { apiKey: undefined, fetchImpl }),
    ).rejects.toMatchObject({ code: "CONFIG" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("parses a valid recovery response with an empty conclusions list (fully acceptable outcome)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent({ conclusions: [], uncertainties: [] }));
    const result = await generateRecoveryConclusions(baseInput, { apiKey: "test-key", fetchImpl });
    expect(result.conclusions).toEqual([]);
  });

  it("parses a valid recovery response with a supported conclusion", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent(validPayload));
    const result = await generateRecoveryConclusions(baseInput, { apiKey: "test-key", fetchImpl });

    expect(result.conclusions).toHaveLength(1);
    expect(result.conclusions[0].support[0]).toEqual({
      sourceId: "SOURCE_1",
      excerpt: "Dłużnik obowiązany jest do naprawienia szkody.",
    });
  });

  it("never sends the rejected first-pass statements — only source text and the user question", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent(validPayload));
    await generateRecoveryConclusions(baseInput, { apiKey: "test-key", fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain(source.text);
    expect(String(init.body)).toContain(baseInput.problemDescription);
    // the prompt only ever says a first draft failed, never repeats its content
    expect(String(init.body)).not.toContain("TWIERDZENIE_ODRZUCONE");
  });

  it("never logs the API key in the request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent(validPayload));
    await generateRecoveryConclusions(baseInput, { apiKey: "super-secret-key", fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer super-secret-key");
    expect(String(init.body)).not.toContain("super-secret-key");
  });

  it("uses strict json_schema Structured Outputs constraining support.sourceId to exactly the supplied SOURCE_X ids", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent(validPayload));
    const twoSources: PackedSource[] = [
      source,
      { ...source, sourceId: "SOURCE_2", legalProvisionId: "p2", citationLabel: "art. 556" },
    ];
    await generateRecoveryConclusions({ ...baseInput, sources: twoSources }, { apiKey: "test-key", fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);

    const schema = body.response_format.json_schema.schema;
    const sourceEnum = schema.properties.conclusions.items.properties.support.items.properties.sourceId.enum;
    expect(sourceEnum).toEqual(["SOURCE_1", "SOURCE_2"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["conclusions", "uncertainties"]);
  });

  it("rejects a response referencing an unknown/fabricated SOURCE_X", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      withContent({
        conclusions: [{ statement: "Twierdzenie.", support: [{ sourceId: "SOURCE_99", excerpt: "x" }] }],
        uncertainties: [],
      }),
    );

    await expect(
      generateRecoveryConclusions(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a conclusion with no support entries", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      withContent({ conclusions: [{ statement: "Twierdzenie bez źródła.", support: [] }], uncertainties: [] }),
    );

    await expect(
      generateRecoveryConclusions(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a support entry missing an excerpt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      chatResponse(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({
                conclusions: [{ statement: "Twierdzenie.", support: [{ sourceId: "SOURCE_1" }] }],
                uncertainties: [],
              }),
            },
          },
        ],
      }),
    );

    await expect(
      generateRecoveryConclusions(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("fails closed when the model refuses to produce a structured response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      chatResponse(200, { choices: [{ message: { content: null, refusal: "cannot comply" }, finish_reason: "stop" }] }),
    );

    await expect(
      generateRecoveryConclusions(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("fails closed when the response is truncated (finish_reason=length)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      chatResponse(200, { choices: [{ message: { content: JSON.stringify(validPayload) }, finish_reason: "length" }] }),
    );

    await expect(
      generateRecoveryConclusions(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects malformed JSON returned by the model", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(chatResponse(200, { choices: [{ message: { content: "not valid json at all" } }] }));

    await expect(
      generateRecoveryConclusions(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("fails clearly on authentication errors without retrying", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(401, { error: "invalid api key" }));

    await expect(generateRecoveryConclusions(baseInput, { apiKey: "bad-key", fetchImpl })).rejects.toMatchObject({
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

      const resultPromise = generateRecoveryConclusions(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 2 });
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
      const resultPromise = generateRecoveryConclusions(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 1 });
      const assertion = expect(resultPromise).rejects.toMatchObject({ code: "HTTP_ERROR", status: 503 });

      await vi.runAllTimersAsync();
      await assertion;
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("RecoveryGenerationError", () => {
  it("carries a code and optional status", () => {
    const error = new RecoveryGenerationError("boom", "HTTP_ERROR", 500);
    expect(error.code).toBe("HTTP_ERROR");
    expect(error.status).toBe(500);
    expect(error.name).toBe("RecoveryGenerationError");
  });
});
