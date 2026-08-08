import { describe, expect, it } from "vitest";

import fixture from "./__fixtures__/du-1964-93.json";
import { parseEliActMetadata } from "./schema";

describe("parseEliActMetadata", () => {
  it("accepts known valid fixture", () => {
    const parsed = parseEliActMetadata(fixture);

    expect(parsed.publisher).toBe("DU");
    expect(parsed.year).toBe(1964);
    expect(parsed.pos).toBe(93);
    expect(parsed.texts?.length).toBeGreaterThan(0);
  });

  it("rejects malformed payload", () => {
    const malformed = {
      ...fixture,
      publisher: "",
      year: "1964",
    };

    expect(() => parseEliActMetadata(malformed)).toThrow();
  });
});
