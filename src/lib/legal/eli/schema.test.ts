import { describe, expect, it } from "vitest";

import fixture from "./__fixtures__/du-1964-93.json";
import structFixture from "./__fixtures__/struct-article-based.json";
import { parseEliActMetadata, parseEliActStruct } from "./schema";

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

describe("parseEliActStruct", () => {
  it("accepts recursive struct fixture", () => {
    const parsed = parseEliActStruct(structFixture);

    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]?.children?.[0]?.children?.[0]?.id).toBe("titl_I");
  });

  it("rejects malformed struct payload", () => {
    const malformed = [{ id: "node_without_type", children: [{ type: "arti" }] }];

    expect(() => parseEliActStruct(malformed)).toThrow();
  });
});
