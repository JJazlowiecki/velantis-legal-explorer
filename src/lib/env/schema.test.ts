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
});
