import { describe, expect, it } from "vitest";

import { DEMO_LEGAL_ACTS, getPublicationYear } from "./legal-acts";
import { DEFAULT_LEGAL_ACT_FILTERS, filterLegalActs } from "./legal-acts-filters";

describe("getPublicationYear", () => {
  it("extracts a four-digit year from a publication label", () => {
    expect(getPublicationYear("Dz.U. 1964 nr 16 poz. 93")).toBe(1964);
    expect(getPublicationYear("Dz.Urz. UE L 119/1")).toBeNull();
  });
});

describe("filterLegalActs", () => {
  it("only returns acts from the selected jurisdiction", () => {
    const result = filterLegalActs(DEMO_LEGAL_ACTS, { ...DEFAULT_LEGAL_ACT_FILTERS, jurisdiction: "EU" });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((act) => act.jurisdiction === "EU")).toBe(true);
  });

  it("filters by category", () => {
    const result = filterLegalActs(DEMO_LEGAL_ACTS, { ...DEFAULT_LEGAL_ACT_FILTERS, category: "Prawo pracy" });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((act) => act.category === "Prawo pracy")).toBe(true);
  });

  it("filters by status", () => {
    const result = filterLegalActs(DEMO_LEGAL_ACTS, { ...DEFAULT_LEGAL_ACT_FILTERS, status: "in_force" });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((act) => act.status === "in_force")).toBe(true);
  });

  it("filters by publication year", () => {
    const result = filterLegalActs(DEMO_LEGAL_ACTS, { ...DEFAULT_LEGAL_ACT_FILTERS, publicationYear: 1964 });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((act) => getPublicationYear(act.publication) === 1964)).toBe(true);
  });

  it("filters by case-insensitive search term", () => {
    const result = filterLegalActs(DEMO_LEGAL_ACTS, { ...DEFAULT_LEGAL_ACT_FILTERS, searchTerm: "kodeks cywilny" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("kc");
  });

  it("combines jurisdiction with category/status/year filters", () => {
    const result = filterLegalActs(DEMO_LEGAL_ACTS, {
      jurisdiction: "PL",
      category: "Prawo cywilne",
      status: "amended",
      searchTerm: "",
      actType: "all",
      publicationYear: "all",
    });
    expect(result.every((act) => act.jurisdiction === "PL" && act.category === "Prawo cywilne" && act.status === "amended")).toBe(true);
  });
});
