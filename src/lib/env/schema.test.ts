import { describe, expect, it } from "vitest";

import { parseServerEnv } from "./schema";

describe("parseServerEnv", () => {
  it("parses required variables", () => {
    const env = parseServerEnv({
      DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/db",
      POSTGRES_DB: "db",
      POSTGRES_USER: "user",
      POSTGRES_PASSWORD: "pass",
    });

    expect(env.POSTGRES_DB).toBe("db");
  });

  it("throws for invalid DATABASE_URL", () => {
    expect(() =>
      parseServerEnv({
        DATABASE_URL: "not-a-url",
        POSTGRES_DB: "db",
        POSTGRES_USER: "user",
        POSTGRES_PASSWORD: "pass",
      }),
    ).toThrow();
  });

  const baseRequired = {
    DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/db",
    POSTGRES_DB: "db",
    POSTGRES_USER: "user",
    POSTGRES_PASSWORD: "pass",
  };

  describe("EXPLORER_HISTORY_ENABLED", () => {
    it("defaults to enabled when unset", () => {
      expect(parseServerEnv(baseRequired).EXPLORER_HISTORY_ENABLED).toBe(true);
    });

    it("parses the literal string \"false\" as disabled", () => {
      expect(parseServerEnv({ ...baseRequired, EXPLORER_HISTORY_ENABLED: "false" }).EXPLORER_HISTORY_ENABLED).toBe(false);
    });

    it("parses the literal string \"true\" as enabled", () => {
      expect(parseServerEnv({ ...baseRequired, EXPLORER_HISTORY_ENABLED: "true" }).EXPLORER_HISTORY_ENABLED).toBe(true);
    });

    it("rejects any value other than the literal strings true/false", () => {
      expect(() => parseServerEnv({ ...baseRequired, EXPLORER_HISTORY_ENABLED: "yes" })).toThrow();
      expect(() => parseServerEnv({ ...baseRequired, EXPLORER_HISTORY_ENABLED: "1" })).toThrow();
    });
  });
});
