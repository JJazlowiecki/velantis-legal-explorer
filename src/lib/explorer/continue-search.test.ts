import { describe, expect, it } from "vitest";

import { buildContinueSearchHref, resolveInitialQuery } from "./continue-search";

describe("resolveInitialQuery", () => {
  it("returns an empty string when q is absent (plain /explorer keeps working)", () => {
    expect(resolveInitialQuery({})).toBe("");
  });

  it("returns the query string value", () => {
    expect(resolveInitialQuery({ q: "sąsiad wyciął moje drzewo" })).toBe("sąsiad wyciął moje drzewo");
  });

  it("takes the first value when q is repeated as an array", () => {
    expect(resolveInitialQuery({ q: ["pierwsze", "drugie"] })).toBe("pierwsze");
  });

  it("returns an empty string for a non-string, non-array value", () => {
    expect(resolveInitialQuery({ q: undefined })).toBe("");
  });
});

describe("buildContinueSearchHref", () => {
  it("builds a /explorer link carrying the query as ?q=", () => {
    expect(buildContinueSearchHref("sąsiad wyciął moje drzewo")).toEqual({
      pathname: "/explorer",
      query: { q: "sąsiad wyciął moje drzewo" },
    });
  });
});
