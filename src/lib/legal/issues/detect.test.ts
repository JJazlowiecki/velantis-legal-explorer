import { describe, expect, it, vi } from "vitest";

import { detectLegalIssues, IssueDetectionError } from "./detect";

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

const validPayload = {
  summary: "Możliwy spór dotyczący jakości usługi remontowej.",
  issues: [
    {
      label: "nienależyte wykonanie zobowiązania",
      likelihood: "most_likely",
      rationale: "Opis wskazuje na wadliwe wykonanie usługi.",
      retrievalQueries: ["nienależyte wykonanie zobowiązania"],
    },
  ],
};

describe("detectLegalIssues", () => {
  it("throws a CONFIG error for an empty problem description", async () => {
    const fetchImpl = vi.fn();
    await expect(detectLegalIssues("   ", { apiKey: "k", fetchImpl })).rejects.toMatchObject({
      code: "CONFIG",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws a CONFIG error when no API key is available", async () => {
    const fetchImpl = vi.fn();
    await expect(
      detectLegalIssues("opis problemu", { apiKey: undefined, fetchImpl }),
    ).rejects.toMatchObject({ code: "CONFIG" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("parses a valid structured response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent(validPayload));
    const result = await detectLegalIssues("opis problemu", { apiKey: "test-key", fetchImpl });

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].likelihood).toBe("most_likely");
  });

  it("never logs the API key in the request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent(validPayload));
    await detectLegalIssues("opis problemu", { apiKey: "super-secret-key", fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer super-secret-key");
    expect(String(init.body)).not.toContain("super-secret-key");
  });

  it("uses strict json_schema Structured Outputs with required fields and no additional properties", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent(validPayload));
    await detectLegalIssues("opis problemu", { apiKey: "test-key", fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);

    const schema = body.response_format.json_schema.schema;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["summary", "issues", "clarificationQuestion"]);
    expect(schema.properties.issues.items.required).toEqual(["label", "likelihood", "rationale", "retrievalQueries"]);
    expect(schema.properties.issues.items.properties.likelihood.enum).toEqual([
      "most_likely",
      "possible",
      "needs_more_information",
    ]);
  });

  it("tolerates a null clarificationQuestion (strict mode's way of expressing 'not asked')", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent({ ...validPayload, clarificationQuestion: null }));
    const result = await detectLegalIssues("opis problemu", { apiKey: "test-key", fetchImpl });
    expect(result.clarificationQuestion).toBeUndefined();
  });

  it("fails closed when the model refuses to produce a structured response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      chatResponse(200, { choices: [{ message: { content: null, refusal: "cannot comply" }, finish_reason: "stop" }] }),
    );

    await expect(
      detectLegalIssues("opis problemu", { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("fails closed when the response is truncated (finish_reason=length)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      chatResponse(200, { choices: [{ message: { content: JSON.stringify(validPayload) }, finish_reason: "length" }] }),
    );

    await expect(
      detectLegalIssues("opis problemu", { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects malformed JSON returned by the model", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(chatResponse(200, { choices: [{ message: { content: "not valid json at all" } }] }));

    await expect(
      detectLegalIssues("opis problemu", { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a well-formed JSON payload with an empty issues array", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent({ summary: "Summary", issues: [] }));

    await expect(
      detectLegalIssues("opis problemu", { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a payload with a fabricated numeric confidence instead of a qualitative likelihood", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      withContent({
        summary: "Summary",
        issues: [{ ...validPayload.issues[0], likelihood: 0.92 }],
      }),
    );

    await expect(
      detectLegalIssues("opis problemu", { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("fails clearly on authentication errors without retrying", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(401, { error: "invalid api key" }));

    await expect(
      detectLegalIssues("opis problemu", { apiKey: "bad-key", fetchImpl }),
    ).rejects.toMatchObject({ code: "HTTP_ERROR", status: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a bounded number of times on transient 5xx failures then succeeds", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(chatResponse(503, { error: "unavailable" }))
        .mockResolvedValueOnce(withContent(validPayload));

      const resultPromise = detectLegalIssues("opis problemu", { apiKey: "test-key", fetchImpl, maxRetries: 2 });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.issues).toHaveLength(1);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never retries indefinitely", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn().mockResolvedValue(chatResponse(503, { error: "unavailable" }));
      const resultPromise = detectLegalIssues("opis problemu", { apiKey: "test-key", fetchImpl, maxRetries: 1 });
      const assertion = expect(resultPromise).rejects.toMatchObject({ code: "HTTP_ERROR", status: 503 });

      await vi.runAllTimersAsync();
      await assertion;
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("IssueDetectionError", () => {
  it("carries a code and optional status", () => {
    const error = new IssueDetectionError("boom", "HTTP_ERROR", 500);
    expect(error.code).toBe("HTTP_ERROR");
    expect(error.status).toBe(500);
    expect(error.name).toBe("IssueDetectionError");
  });
});
