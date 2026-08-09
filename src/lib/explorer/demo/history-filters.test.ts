import { describe, expect, it } from "vitest";

import { DEMO_HISTORY_ENTRIES } from "./history";
import { DEFAULT_HISTORY_FILTERS, filterHistoryEntries } from "./history-filters";

describe("filterHistoryEntries", () => {
  it("returns everything when filters are at their defaults", () => {
    expect(filterHistoryEntries(DEMO_HISTORY_ENTRIES, DEFAULT_HISTORY_FILTERS)).toHaveLength(DEMO_HISTORY_ENTRIES.length);
  });

  it("filters by case-insensitive search term against the title", () => {
    const result = filterHistoryEntries(DEMO_HISTORY_ENTRIES, { ...DEFAULT_HISTORY_FILTERS, searchTerm: "PRZEDAWNIA" });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((entry) => entry.title.toLowerCase().includes("przedawnia"))).toBe(true);
  });

  it("filters by entry type", () => {
    const result = filterHistoryEntries(DEMO_HISTORY_ENTRIES, { ...DEFAULT_HISTORY_FILTERS, type: "provision" });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((entry) => entry.type === "provision")).toBe(true);
  });

  it("filters by group", () => {
    const result = filterHistoryEntries(DEMO_HISTORY_ENTRIES, { ...DEFAULT_HISTORY_FILTERS, group: "today" });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((entry) => entry.group === "today")).toBe(true);
  });

  it("combines filters (AND semantics)", () => {
    const result = filterHistoryEntries(DEMO_HISTORY_ENTRIES, { searchTerm: "art", type: "provision", group: "today" });
    expect(result.every((entry) => entry.type === "provision" && entry.group === "today" && entry.title.toLowerCase().includes("art"))).toBe(
      true,
    );
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterHistoryEntries(DEMO_HISTORY_ENTRIES, { ...DEFAULT_HISTORY_FILTERS, searchTerm: "zzz-no-match-zzz" })).toEqual([]);
  });
});
