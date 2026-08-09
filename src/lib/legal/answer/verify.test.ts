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

const supportedPayload = {
  results: [{ conclusionIndex: 0, supported: true, reason: "Źródło wprost stanowi podstawę.", supportingSourceIds: ["SOURCE_1"] }],
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

  it("parses a valid supported verification result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent(supportedPayload));
    const result = await verifyConclusionSupport(baseInput, { apiKey: "test-key", fetchImpl });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ conclusionIndex: 0, supported: true, supportingSourceIds: ["SOURCE_1"] });
  });

  it("parses a valid unsupported verification result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      withContent({
        results: [
          { conclusionIndex: 0, supported: false, reason: "Źródło dotyczy innej instytucji prawnej.", supportingSourceIds: [] },
        ],
      }),
    );
    const result = await verifyConclusionSupport(baseInput, { apiKey: "test-key", fetchImpl });

    expect(result[0]).toMatchObject({ supported: false, supportingSourceIds: [] });
  });

  it("never logs the API key in the request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent(supportedPayload));
    await verifyConclusionSupport(baseInput, { apiKey: "super-secret-key", fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer super-secret-key");
    expect(String(init.body)).not.toContain("super-secret-key");
  });

  it("only sends the sources claimed by each conclusion, not unrelated retrieved sources", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent(supportedPayload));
    await verifyConclusionSupport(baseInput, { apiKey: "test-key", fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain("SOURCE_1");
    expect(String(init.body)).not.toContain("SOURCE_2");
  });

  it("rejects a response referencing an unknown/fabricated SOURCE_X for a conclusion", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      withContent({
        results: [{ conclusionIndex: 0, supported: true, reason: "reason", supportingSourceIds: ["SOURCE_99"] }],
      }),
    );

    await expect(
      verifyConclusionSupport(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects supported=true with empty supportingSourceIds", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      withContent({ results: [{ conclusionIndex: 0, supported: true, reason: "reason", supportingSourceIds: [] }] }),
    );

    await expect(
      verifyConclusionSupport(baseInput, { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a response missing a result for a supplied conclusionIndex", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withContent({ results: [] }));

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
        .mockResolvedValueOnce(withContent(supportedPayload));

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
        results: [
          { conclusionIndex: 0, supported: true, reason: "ok", supportingSourceIds: ["SOURCE_1"] },
          { conclusionIndex: 1, supported: false, reason: "nie dotyczy", supportingSourceIds: [] },
        ],
      }),
    );

    const result = await verifyConclusionSupport(multiInput, { apiKey: "test-key", fetchImpl });
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.conclusionIndex === 0)?.supported).toBe(true);
    expect(result.find((r) => r.conclusionIndex === 1)?.supported).toBe(false);
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
