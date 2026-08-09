import { describe, expect, it } from "vitest";

import { DEMO_SAVED_ITEMS } from "./saved";
import { DEFAULT_SAVED_FILTERS, filterAndSortSavedItems } from "./saved-filters";

describe("filterAndSortSavedItems", () => {
  it("returns everything sorted by save date descending by default", () => {
    const result = filterAndSortSavedItems(DEMO_SAVED_ITEMS, DEFAULT_SAVED_FILTERS);
    expect(result).toHaveLength(DEMO_SAVED_ITEMS.length);
    const dates = result.map((item) => item.savedDate);
    const sortedDatesDesc = [...dates].sort((a, b) => b.localeCompare(a));
    expect(dates).toEqual(sortedDatesDesc);
  });

  it("filters by tab (item type)", () => {
    const result = filterAndSortSavedItems(DEMO_SAVED_ITEMS, { ...DEFAULT_SAVED_FILTERS, tab: "act" });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((item) => item.type === "act")).toBe(true);
  });

  it("filters by folder id", () => {
    const result = filterAndSortSavedItems(DEMO_SAVED_ITEMS, { ...DEFAULT_SAVED_FILTERS, folderId: "f-labor" });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((item) => item.folderId === "f-labor")).toBe(true);
  });

  it("filters items with no folder when folderId is explicitly null", () => {
    const result = filterAndSortSavedItems(DEMO_SAVED_ITEMS, { ...DEFAULT_SAVED_FILTERS, folderId: null });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((item) => item.folderId === null)).toBe(true);
  });

  it("filters by case-insensitive search term", () => {
    const result = filterAndSortSavedItems(DEMO_SAVED_ITEMS, { ...DEFAULT_SAVED_FILTERS, searchTerm: "kodeks cywilny" });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((item) => item.title.toLowerCase().includes("kodeks cywilny"))).toBe(true);
  });

  it("sorts by title ascending when requested", () => {
    const result = filterAndSortSavedItems(DEMO_SAVED_ITEMS, { ...DEFAULT_SAVED_FILTERS, sort: "title_asc" });
    const titles = result.map((item) => item.title);
    const sortedTitles = [...titles].sort((a, b) => a.localeCompare(b));
    expect(titles).toEqual(sortedTitles);
  });

  it("sorts by save date ascending when requested", () => {
    const result = filterAndSortSavedItems(DEMO_SAVED_ITEMS, { ...DEFAULT_SAVED_FILTERS, sort: "date_asc" });
    const dates = result.map((item) => item.savedDate);
    const sortedDatesAsc = [...dates].sort((a, b) => a.localeCompare(b));
    expect(dates).toEqual(sortedDatesAsc);
  });
});
