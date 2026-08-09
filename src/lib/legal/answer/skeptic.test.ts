import { describe, expect, it, vi } from "vitest";

import { SkepticalVerificationError, runSkepticalVerification } from "./skeptic";
import type { ConclusionForSkepticReview } from "./skeptic";

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

const conclusion: ConclusionForSkepticReview = {
  conclusionIndex: 0,
  statement: "Dłużnik odpowiada za nienależyte wykonanie zobowiązania.",
  sources: [
    { sourceId: "SOURCE_1", citationLabel: "art. 471", text: "Art. 471. Dłużnik obowiązany jest do naprawienia szkody." },
  ],
  confirmedExcerpts: [{ sourceId: "SOURCE_1", excerpt: "Dłużnik obowiązany jest do naprawienia szkody." }],
};

const baseInput = {
  problemDescription: "problem",
  conclusions: [conclusion],
};

// Strict Structured Outputs response shape: a required, keyed `result_<conclusionIndex>`
// property per conclusion under review — NOT an array (see buildSkepticJsonSchema for why).
// runSkepticalVerification reshapes this back into `{results: [{conclusionIndex, ...}]}`
// before Zod validation and before returning, so the function's return type is unaffected.
const noLeapPayload = {
  result_0: { hasUnsupportedLeap: false, reason: "Dowód w pełni ustanawia twierdzenie." },
};

describe("runSkepticalVerification", () => {
  it("throws a CONFIG error and makes no request when there are zero conclusions", async () => {
    const fetchImpl = vi.fn();
    await expect(
      runSkepticalVerification({ ...baseInput, conclusions: [] }, { apiKey: "k", fetchImpl }),
    ).rejects.toMatchObject({ code: "CONFIG" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws a CONFIG error when no API key is available", async () => {
    const fetchImpl = vi.fn();
    await expect(
      runSkepticalVerification(baseInput, { apiKey: undefined, fetchImpl }),
    ).rejects.toMatchObject({ code: "CONFIG" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("parses a valid hasUnsupportedLeap=false result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent(noLeapPayload));
    const result = await runSkepticalVerification(baseInput, { apiKey: "test-key", fetchImpl });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ conclusionIndex: 0, hasUnsupportedLeap: false });
  });

  it("parses a valid hasUnsupportedLeap=true result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      withContent({
        result_0: { hasUnsupportedLeap: true, reason: "Rozszerzenie zakresu przepisu proceduralnego." },
      }),
    );
    const result = await runSkepticalVerification(baseInput, { apiKey: "test-key", fetchImpl });

    expect(result[0]).toMatchObject({ hasUnsupportedLeap: true });
  });

  it("never logs the API key in the request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent(noLeapPayload));
    await runSkepticalVerification(baseInput, { apiKey: "super-secret-key", fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer super-secret-key");
    expect(String(init.body)).not.toContain("super-secret-key");
  });

  it("sends the confirmed excerpts and source context in the request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent(noLeapPayload));
    await runSkepticalVerification(baseInput, { apiKey: "test-key", fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain("Dłużnik obowiązany jest do naprawienia szkody.");
    expect(String(init.body)).toContain("SOURCE_1");
  });

  it("F: uses strict json_schema Structured Outputs with a required result_<index> key per conclusion (not an array), so the model cannot omit one", async () => {
    const multiInput = {
      problemDescription: "problem",
      conclusions: [
        conclusion,
        {
          conclusionIndex: 4,
          statement: "Kupujący może żądać usunięcia wady.",
          sources: [{ sourceId: "SOURCE_2", citationLabel: "art. 556", text: "Art. 556. Rękojmia za wady." }],
          confirmedExcerpts: [{ sourceId: "SOURCE_2", excerpt: "Rękojmia za wady." }],
        },
      ],
    };
    const fetchImpl = vi.fn().mockResolvedValue(
      withContent({
        result_0: { hasUnsupportedLeap: false, reason: "ok" },
        result_4: { hasUnsupportedLeap: true, reason: "leap" },
      }),
    );
    await runSkepticalVerification(multiInput, { apiKey: "test-key", fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);

    const schema = body.response_format.json_schema.schema;
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["result_0", "result_4"]);
    expect(Object.keys(schema.properties)).toEqual(["result_0", "result_4"]);
    expect(schema.properties.result_0.additionalProperties).toBe(false);
    expect(schema.properties.result_0.required).toEqual(["hasUnsupportedLeap", "reason"]);
    expect(schema.properties.result_0.properties.hasUnsupportedLeap.type).toBe("boolean");
  });

  it("H: fails closed when the model refuses to produce a structured response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      chatResponse(200, { choices: [{ message: { content: null, refusal: "cannot comply" }, finish_reason: "stop" }] }),
    );

    await expect(
      runSkepticalVerification(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("H: fails closed when the response is truncated (finish_reason=length)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      chatResponse(200, { choices: [{ message: { content: JSON.stringify(noLeapPayload) }, finish_reason: "length" }] }),
    );

    await expect(
      runSkepticalVerification(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a response missing a result for a supplied conclusionIndex", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent({}));

    await expect(
      runSkepticalVerification(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a response referencing an unknown conclusionIndex key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      withContent({ result_5: { hasUnsupportedLeap: false, reason: "reason" } }),
    );

    await expect(
      runSkepticalVerification(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects malformed JSON returned by the model", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(chatResponse(200, { choices: [{ message: { content: "not valid json at all" } }] }));

    await expect(
      runSkepticalVerification(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("fails clearly on authentication errors without retrying", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(401, { error: "invalid api key" }));

    await expect(runSkepticalVerification(baseInput, { apiKey: "bad-key", fetchImpl })).rejects.toMatchObject({
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
        .mockResolvedValueOnce(withContent(noLeapPayload));

      const resultPromise = runSkepticalVerification(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 2 });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toHaveLength(1);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("supports reviewing multiple conclusions in one batched call", async () => {
    const multiInput = {
      problemDescription: "problem",
      conclusions: [
        conclusion,
        {
          conclusionIndex: 2,
          statement: "Kupujący może żądać usunięcia wady.",
          sources: [{ sourceId: "SOURCE_2", citationLabel: "art. 556", text: "Art. 556. Rękojmia za wady." }],
          confirmedExcerpts: [{ sourceId: "SOURCE_2", excerpt: "Rękojmia za wady." }],
        },
      ],
    };
    const fetchImpl = vi.fn().mockResolvedValue(
      withContent({
        result_0: { hasUnsupportedLeap: false, reason: "ok" },
        result_2: { hasUnsupportedLeap: true, reason: "rozszerzenie zakresu" },
      }),
    );

    const result = await runSkepticalVerification(multiInput, { apiKey: "test-key", fetchImpl });
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.conclusionIndex === 0)?.hasUnsupportedLeap).toBe(false);
    expect(result.find((r) => r.conclusionIndex === 2)?.hasUnsupportedLeap).toBe(true);
  });
});

describe("SkepticalVerificationError", () => {
  it("carries a code and optional status", () => {
    const error = new SkepticalVerificationError("boom", "HTTP_ERROR", 500);
    expect(error.code).toBe("HTTP_ERROR");
    expect(error.status).toBe(500);
    expect(error.name).toBe("SkepticalVerificationError");
  });
});
