import { describe, expect, it } from "vitest";

import { EXPLORER_QUERY_MAX_LENGTH, EXPLORER_QUERY_MIN_LENGTH, validateExplorerQuery } from "./query-validation";

describe("validateExplorerQuery", () => {
  it("accepts a normal, trimmed query", () => {
    const result = validateExplorerQuery("  urzędnik nie wie do kogo się zwrócić  ");
    expect(result).toEqual({ ok: true, query: "urzędnik nie wie do kogo się zwrócić" });
  });

  it("rejects a non-string value", () => {
    expect(validateExplorerQuery(undefined)).toMatchObject({ ok: false });
    expect(validateExplorerQuery(42)).toMatchObject({ ok: false });
    expect(validateExplorerQuery(null)).toMatchObject({ ok: false });
  });

  it("rejects blank/whitespace-only input", () => {
    const result = validateExplorerQuery("   ");
    expect(result.ok).toBe(false);
  });

  it("rejects input below the minimum length", () => {
    const tooShort = "a".repeat(EXPLORER_QUERY_MIN_LENGTH - 1);
    const result = validateExplorerQuery(tooShort);
    expect(result.ok).toBe(false);
  });

  it("accepts input exactly at the minimum length", () => {
    const exact = "a".repeat(EXPLORER_QUERY_MIN_LENGTH);
    expect(validateExplorerQuery(exact)).toEqual({ ok: true, query: exact });
  });

  it("rejects input above the maximum length", () => {
    const tooLong = "a".repeat(EXPLORER_QUERY_MAX_LENGTH + 1);
    const result = validateExplorerQuery(tooLong);
    expect(result.ok).toBe(false);
  });

  it("accepts input exactly at the maximum length", () => {
    const exact = "a".repeat(EXPLORER_QUERY_MAX_LENGTH);
    expect(validateExplorerQuery(exact)).toEqual({ ok: true, query: exact });
  });
});
