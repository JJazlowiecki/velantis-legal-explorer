import { describe, expect, it } from "vitest";

import { parseExactCitation } from "./citation";

describe("parseExactCitation", () => {
  it("parses a bare article citation with a trailing dot", () => {
    expect(parseExactCitation("art. 471")).toEqual({
      article: "471",
      paragraph: null,
      point: null,
      letter: null,
    });
  });

  it("parses a bare article citation without a dot", () => {
    expect(parseExactCitation("art 471")).toEqual({
      article: "471",
      paragraph: null,
      point: null,
      letter: null,
    });
  });

  it("parses article + ustęp", () => {
    expect(parseExactCitation("art. 5 ust. 2")).toEqual({
      article: "5",
      paragraph: "2",
      point: null,
      letter: null,
    });
  });

  it("parses article + § as paragraph", () => {
    expect(parseExactCitation("art 87 § 1")).toEqual({
      article: "87",
      paragraph: "1",
      point: null,
      letter: null,
    });
  });

  it("parses a bare § as a paragraph search across any article", () => {
    expect(parseExactCitation("§ 4")).toEqual({
      article: null,
      paragraph: "4",
      point: null,
      letter: null,
    });
  });

  it("parses § used as the top-level unit with ustęp and punkt", () => {
    expect(parseExactCitation("§ 4 ust. 2 pkt 3")).toEqual({
      article: "4",
      paragraph: "2",
      point: "3",
      letter: null,
    });
  });

  it("parses letters", () => {
    expect(parseExactCitation("art. 5 ust. 2 pkt 3 lit. a")).toEqual({
      article: "5",
      paragraph: "2",
      point: "3",
      letter: "a",
    });
  });

  it("returns null for natural-language queries with no citation", () => {
    expect(parseExactCitation("odpowiedzialność za niewykonanie umowy")).toBeNull();
  });

  it("returns null for an empty query", () => {
    expect(parseExactCitation("   ")).toBeNull();
  });

  it("does not misfire on unrelated words containing 'art'", () => {
    expect(parseExactCitation("kwartalne sprawozdanie")).toBeNull();
  });

  it("keeps identifiers as strings, not numbers", () => {
    const result = parseExactCitation("art. 1a");
    expect(result?.article).toBe("1a");
    expect(typeof result?.article).toBe("string");
  });
});
