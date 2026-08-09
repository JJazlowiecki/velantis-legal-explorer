import { describe, expect, it } from "vitest";

import { DEFAULT_SAVED_LIST_FILTERS, filterAndSortSavedListItems } from "./list-filters";
import type { SavedListItem } from "./list-view";

const items: SavedListItem[] = [
  { id: "1", kind: "answer", title: "Termin odwołania", query: "termin odwołania", folderId: "f1", createdAt: "2026-01-03T10:00:00.000Z", sourceOrStatus: "2 źródła" },
  { id: "2", kind: "provision", title: "Art. 30 Kodeksu pracy", query: null, folderId: "f1", createdAt: "2026-01-01T10:00:00.000Z", sourceOrStatus: "przepis" },
  { id: "3", kind: "search", title: "przedawnienie roszczeń", query: "przedawnienie roszczeń", folderId: null, createdAt: "2026-01-02T10:00:00.000Z", sourceOrStatus: "zapisane wyszukiwanie" },
];

describe("filterAndSortSavedListItems", () => {
  it("returns all items sorted newest-first by default", () => {
    const result = filterAndSortSavedListItems(items, DEFAULT_SAVED_LIST_FILTERS);
    expect(result.map((i) => i.id)).toEqual(["1", "3", "2"]);
  });

  it("filters by tab/kind", () => {
    const result = filterAndSortSavedListItems(items, { ...DEFAULT_SAVED_LIST_FILTERS, tab: "provision" });
    expect(result.map((i) => i.id)).toEqual(["2"]);
  });

  it("the 'act' tab always yields an empty result (no real saved-act items exist yet)", () => {
    const result = filterAndSortSavedListItems(items, { ...DEFAULT_SAVED_LIST_FILTERS, tab: "act" });
    expect(result).toEqual([]);
  });

  it("filters by folder", () => {
    const result = filterAndSortSavedListItems(items, { ...DEFAULT_SAVED_LIST_FILTERS, folderId: "f1" });
    expect(result.map((i) => i.id).sort()).toEqual(["1", "2"]);
  });

  it("filters by folderId null ('Bez folderu')", () => {
    const result = filterAndSortSavedListItems(items, { ...DEFAULT_SAVED_LIST_FILTERS, folderId: null });
    expect(result.map((i) => i.id)).toEqual(["3"]);
  });

  it("filters by search term across title and query", () => {
    const result = filterAndSortSavedListItems(items, { ...DEFAULT_SAVED_LIST_FILTERS, searchTerm: "odwołania" });
    expect(result.map((i) => i.id)).toEqual(["1"]);
  });

  it("sorts oldest-first", () => {
    const result = filterAndSortSavedListItems(items, { ...DEFAULT_SAVED_LIST_FILTERS, sort: "date_asc" });
    expect(result.map((i) => i.id)).toEqual(["2", "3", "1"]);
  });

  it("sorts title A-Z", () => {
    const result = filterAndSortSavedListItems(items, { ...DEFAULT_SAVED_LIST_FILTERS, sort: "title_asc" });
    expect(result.map((i) => i.id)).toEqual(["2", "3", "1"]);
  });

  it("combines filters with AND semantics", () => {
    const result = filterAndSortSavedListItems(items, { ...DEFAULT_SAVED_LIST_FILTERS, tab: "provision", folderId: "f1" });
    expect(result.map((i) => i.id)).toEqual(["2"]);

    const empty = filterAndSortSavedListItems(items, { ...DEFAULT_SAVED_LIST_FILTERS, tab: "provision", folderId: null });
    expect(empty).toEqual([]);
  });
});
