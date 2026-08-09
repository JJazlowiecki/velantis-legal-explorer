import { describe, expect, it } from "vitest";

import { buildContentKey, normalizeQueryForContentKey } from "./content-key";

describe("buildContentKey", () => {
  it("is deterministic for the same kind and seed", () => {
    expect(buildContentKey("answer", "seed-1")).toBe(buildContentKey("answer", "seed-1"));
  });

  it("differs for different seeds", () => {
    expect(buildContentKey("answer", "seed-1")).not.toBe(buildContentKey("answer", "seed-2"));
  });

  it("differs for different kinds, even with the same seed", () => {
    expect(buildContentKey("answer", "same-seed")).not.toBe(buildContentKey("search", "same-seed"));
    expect(buildContentKey("answer", "same-seed")).not.toBe(buildContentKey("provision", "same-seed"));
  });

  it("is prefixed by kind (aids debugging, not relied upon for uniqueness)", () => {
    expect(buildContentKey("provision", "x")).toMatch(/^provision:/);
  });
});

describe("normalizeQueryForContentKey", () => {
  it("trims and lowercases", () => {
    expect(normalizeQueryForContentKey("  Sąsiad Wyciął Drzewo  ")).toBe("sąsiad wyciął drzewo");
  });

  it("collapses internal whitespace runs", () => {
    expect(normalizeQueryForContentKey("a   b\tc\n d")).toBe("a b c d");
  });

  it("makes trivially-retyped queries produce the same content key", () => {
    const a = buildContentKey("search", normalizeQueryForContentKey("  Przedawnienie   roszczeń  "));
    const b = buildContentKey("search", normalizeQueryForContentKey("przedawnienie roszczeń"));
    expect(a).toBe(b);
  });
});
