import { describe, expect, it, vi } from "vitest";

import { ConclusionVerificationError, verifyConclusionSupport } from "./verify";
import type { ConclusionToVerify } from "./verify";

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

const conclusion: ConclusionToVerify = {
  conclusionIndex: 0,
  statement: "Dłużnik może ponosić odpowiedzialność za nienależyte wykonanie zobowiązania.",
  sources: [
    { sourceId: "SOURCE_1", citationLabel: "art. 471", text: "Art. 471. Dłużnik obowiązany jest do naprawienia szkody." },
  ],
};

const baseInput = {
  problemDescription: "firma remontowa źle zrobiła remont",
  conclusions: [conclusion],
};

// Strict Structured Outputs response shape: a required, keyed `result_<conclusionIndex>`
// property per conclusion — NOT an array — so OpenAI's constrained decoding cannot omit one
// (see buildStrictVerificationJsonSchema in verify.ts for why). verify.ts reshapes this back
// into the `{results: [{conclusionIndex, ...}]}` array before Zod validation and before
// returning to callers, so `verifyConclusionSupport`'s return type is unaffected by this.
const directSupportPayload = {
  result_0: {
    verdict: "direct_support",
    reason: "Źródło wprost stanowi podstawę.",
    evidence: [{ sourceId: "SOURCE_1", excerpt: "Dłużnik obowiązany jest do naprawienia szkody." }],
  },
};

describe("verifyConclusionSupport", () => {
  it("throws a CONFIG error and makes no request when there are zero conclusions", async () => {
    const fetchImpl = vi.fn();
    await expect(
      verifyConclusionSupport({ ...baseInput, conclusions: [] }, { apiKey: "k", fetchImpl }),
    ).rejects.toMatchObject({ code: "CONFIG" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws a CONFIG error when no API key is available", async () => {
    const fetchImpl = vi.fn();
    await expect(
      verifyConclusionSupport(baseInput, { apiKey: undefined, fetchImpl }),
    ).rejects.toMatchObject({ code: "CONFIG" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("parses a valid direct_support verification result with evidence", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent(directSupportPayload));
    const result = await verifyConclusionSupport(baseInput, { apiKey: "test-key", fetchImpl });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      conclusionIndex: 0,
      verdict: "direct_support",
      evidence: [{ sourceId: "SOURCE_1", excerpt: "Dłużnik obowiązany jest do naprawienia szkody." }],
    });
  });

  it("parses a valid no_support verification result with empty evidence", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      withContent({
        result_0: { verdict: "no_support", reason: "Źródło dotyczy innej instytucji prawnej.", evidence: [] },
      }),
    );
    const result = await verifyConclusionSupport(baseInput, { apiKey: "test-key", fetchImpl });

    expect(result[0]).toMatchObject({ verdict: "no_support", evidence: [] });
  });

  it("parses a valid partial_support verification result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      withContent({
        result_0: { verdict: "partial_support", reason: "Źródło potwierdza tylko część szerszej tezy.", evidence: [] },
      }),
    );
    const result = await verifyConclusionSupport(baseInput, { apiKey: "test-key", fetchImpl });

    expect(result[0]).toMatchObject({ verdict: "partial_support", evidence: [] });
  });

  it("never logs the API key in the request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent(directSupportPayload));
    await verifyConclusionSupport(baseInput, { apiKey: "super-secret-key", fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer super-secret-key");
    expect(String(init.body)).not.toContain("super-secret-key");
  });

  it("only sends the sources claimed by each conclusion, not unrelated retrieved sources", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent(directSupportPayload));
    await verifyConclusionSupport(baseInput, { apiKey: "test-key", fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain("SOURCE_1");
    expect(String(init.body)).not.toContain("SOURCE_2");
  });

  it("D: uses strict json_schema Structured Outputs with a required result_<index> key per conclusion (not an array), so the model cannot omit one", async () => {
    const multiInput = {
      problemDescription: "problem",
      conclusions: [
        conclusion,
        {
          conclusionIndex: 3,
          statement: "Kupujący może żądać usunięcia wady.",
          sources: [{ sourceId: "SOURCE_2", citationLabel: "art. 556", text: "Art. 556. Rękojmia za wady." }],
        },
      ],
    };
    const fetchImpl = vi.fn().mockResolvedValue(
      withContent({
        result_0: { verdict: "direct_support", reason: "ok", evidence: [{ sourceId: "SOURCE_1", excerpt: "x" }] },
        result_3: { verdict: "no_support", reason: "no", evidence: [] },
      }),
    );
    await verifyConclusionSupport(multiInput, { apiKey: "test-key", fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);

    const schema = body.response_format.json_schema.schema;
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    // required keys are exactly result_0 and result_3 — no array, no omittable count
    expect(schema.required).toEqual(["result_0", "result_3"]);
    expect(Object.keys(schema.properties)).toEqual(["result_0", "result_3"]);
    expect(schema.properties.result_0.additionalProperties).toBe(false);
    expect(schema.properties.result_0.required).toEqual(["verdict", "reason", "evidence"]);

    const verdictEnum = schema.properties.result_0.properties.verdict.enum;
    expect(verdictEnum).toEqual(["direct_support", "partial_support", "no_support"]);

    const sourceEnum = schema.properties.result_0.properties.evidence.items.properties.sourceId.enum;
    expect(sourceEnum).toEqual(["SOURCE_1", "SOURCE_2"]);
  });

  it("E: application-level validation still rejects a response missing a required conclusion result, even under strict Structured Outputs", async () => {
    const multiInput = {
      problemDescription: "problem",
      conclusions: [
        conclusion,
        {
          conclusionIndex: 1,
          statement: "Kupujący może żądać usunięcia wady.",
          sources: [{ sourceId: "SOURCE_2", citationLabel: "art. 556", text: "Art. 556. Rękojmia za wady." }],
        },
      ],
    };
    // Only one of the two required result_<index> keys is present — simulates a model that
    // (despite strict mode) returns a malformed/incomplete payload; Zod is the final backstop.
    const fetchImpl = vi.fn().mockResolvedValue(
      withContent({
        result_0: { verdict: "direct_support", reason: "ok", evidence: [{ sourceId: "SOURCE_1", excerpt: "x" }] },
      }),
    );

    await expect(
      verifyConclusionSupport(multiInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("H: fails closed when the model refuses to produce a structured response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      chatResponse(200, { choices: [{ message: { content: null, refusal: "cannot comply" }, finish_reason: "stop" }] }),
    );

    await expect(
      verifyConclusionSupport(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("H: fails closed when the response is truncated (finish_reason=length)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      chatResponse(200, {
        choices: [{ message: { content: JSON.stringify(directSupportPayload) }, finish_reason: "length" }],
      }),
    );

    await expect(
      verifyConclusionSupport(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a response referencing an unknown/fabricated SOURCE_X for a conclusion", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      withContent({
        result_0: { verdict: "direct_support", reason: "reason", evidence: [{ sourceId: "SOURCE_99", excerpt: "cokolwiek" }] },
      }),
    );

    await expect(
      verifyConclusionSupport(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects verdict=direct_support with empty evidence", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      withContent({ result_0: { verdict: "direct_support", reason: "reason", evidence: [] } }),
    );

    await expect(
      verifyConclusionSupport(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects an unknown verdict value", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      withContent({ result_0: { verdict: "mostly_supported", reason: "reason", evidence: [] } }),
    );

    await expect(
      verifyConclusionSupport(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a response missing a result for a supplied conclusionIndex", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent({}));

    await expect(
      verifyConclusionSupport(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects malformed JSON returned by the model", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(chatResponse(200, { choices: [{ message: { content: "not valid json at all" } }] }));

    await expect(
      verifyConclusionSupport(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("fails clearly on authentication errors without retrying", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(401, { error: "invalid api key" }));

    await expect(verifyConclusionSupport(baseInput, { apiKey: "bad-key", fetchImpl })).rejects.toMatchObject({
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
        .mockResolvedValueOnce(withContent(directSupportPayload));

      const resultPromise = verifyConclusionSupport(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 2 });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toHaveLength(1);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never retries indefinitely", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn().mockResolvedValue(chatResponse(503, { error: "unavailable" }));
      const resultPromise = verifyConclusionSupport(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 1 });
      const assertion = expect(resultPromise).rejects.toMatchObject({ code: "HTTP_ERROR", status: 503 });

      await vi.runAllTimersAsync();
      await assertion;
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("supports verifying multiple conclusions in one call, each scoped to its own sources", async () => {
    const multiInput = {
      problemDescription: "problem",
      conclusions: [
        conclusion,
        {
          conclusionIndex: 1,
          statement: "Kupujący może żądać usunięcia wady.",
          sources: [{ sourceId: "SOURCE_2", citationLabel: "art. 556", text: "Art. 556. Rękojmia za wady." }],
        },
      ],
    };
    const fetchImpl = vi.fn().mockResolvedValue(
      withContent({
        result_0: {
          verdict: "direct_support",
          reason: "ok",
          evidence: [{ sourceId: "SOURCE_1", excerpt: "Dłużnik obowiązany jest do naprawienia szkody." }],
        },
        result_1: { verdict: "no_support", reason: "nie dotyczy", evidence: [] },
      }),
    );

    const result = await verifyConclusionSupport(multiInput, { apiKey: "test-key", fetchImpl });
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.conclusionIndex === 0)?.verdict).toBe("direct_support");
    expect(result.find((r) => r.conclusionIndex === 1)?.verdict).toBe("no_support");
  });
});

describe("ConclusionVerificationError", () => {
  it("carries a code and optional status", () => {
    const error = new ConclusionVerificationError("boom", "HTTP_ERROR", 500);
    expect(error.code).toBe("HTTP_ERROR");
    expect(error.status).toBe(500);
    expect(error.name).toBe("ConclusionVerificationError");
  });
});
