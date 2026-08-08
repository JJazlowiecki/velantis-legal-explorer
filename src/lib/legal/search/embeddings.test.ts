import { describe, expect, it, vi } from "vitest";

import { EmbeddingError, embedTexts } from "./embeddings";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("embedTexts", () => {
  it("returns an empty array without making a request for no input", async () => {
    const fetchImpl = vi.fn();
    const result = await embedTexts([], { apiKey: "test-key", fetchImpl });
    expect(result).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws a CONFIG error when no API key is available", async () => {
    const fetchImpl = vi.fn();
    await expect(
      embedTexts(["hello"], { apiKey: undefined, fetchImpl }),
    ).rejects.toMatchObject({ code: "CONFIG" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("parses embeddings sorted by index regardless of response order", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] },
        ],
      }),
    );

    const result = await embedTexts(["a", "b"], { apiKey: "test-key", fetchImpl });
    expect(result).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it("never logs the API key in request construction", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ index: 0, embedding: [1] }] }));
    await embedTexts(["a"], { apiKey: "super-secret-key", fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer super-secret-key");
    expect(JSON.stringify(init.body)).not.toContain("super-secret-key");
  });

  it("fails clearly on authentication errors without retrying", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: "invalid api key" }));

    await expect(embedTexts(["a"], { apiKey: "bad-key", fetchImpl })).rejects.toMatchObject({
      code: "HTTP_ERROR",
      status: 401,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a bounded number of times on transient 429s then succeeds", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(429, { error: "rate limited" }))
        .mockResolvedValueOnce(jsonResponse(429, { error: "rate limited" }))
        .mockResolvedValueOnce(jsonResponse(200, { data: [{ index: 0, embedding: [0.5] }] }));

      const resultPromise = embedTexts(["a"], {
        apiKey: "test-key",
        fetchImpl,
        maxRetries: 3,
      });

      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toEqual([[0.5]]);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never retries indefinitely on persistent 5xx failures", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(503, { error: "unavailable" }));

      const resultPromise = embedTexts(["a"], { apiKey: "test-key", fetchImpl, maxRetries: 2 });
      const assertion = expect(resultPromise).rejects.toMatchObject({
        code: "HTTP_ERROR",
        status: 503,
      });

      await vi.runAllTimersAsync();
      await assertion;
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws INVALID_RESPONSE for malformed payloads", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: true }));

    await expect(
      embedTexts(["a"], { apiKey: "test-key", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

describe("EmbeddingError", () => {
  it("carries a code and optional status", () => {
    const error = new EmbeddingError("boom", "HTTP_ERROR", 500);
    expect(error.code).toBe("HTTP_ERROR");
    expect(error.status).toBe(500);
    expect(error.name).toBe("EmbeddingError");
  });
});
