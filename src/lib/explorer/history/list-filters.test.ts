import { describe, expect, it } from "vitest";

import { DEFAULT_HISTORY_LIST_FILTERS, filterHistoryListItems, type HistoryListFilters } from "./list-filters";
import type { HistoryListItem } from "./list-view";

const NOW = new Date(2026, 0, 15, 12, 0, 0);

function item(overrides: Partial<HistoryListItem> = {}): HistoryListItem {
  return {
    id: "h1",
    query: "przedawnienie roszczenia z faktury",
    status: "answered",
    createdAt: new Date(2026, 0, 15, 8, 0, 0).toISOString(),
    sourceCount: 3,
    answerPreview: "Podgląd.",
    ...overrides,
  };
}

describe("filterHistoryListItems", () => {
  it("returns everything at default filters", () => {
    const items = [item({ id: "a" }), item({ id: "b" })];
    expect(filterHistoryListItems(items, DEFAULT_HISTORY_LIST_FILTERS, NOW)).toHaveLength(2);
  });

  it("filters by case-insensitive query substring", () => {
    const items = [item({ id: "a", query: "przedawnienie roszczenia" }), item({ id: "b", query: "odwołanie od wypowiedzenia" })];
    const result = filterHistoryListItems(items, { ...DEFAULT_HISTORY_LIST_FILTERS, searchTerm: "PRZEDAWNIENIE" }, NOW);
    expect(result.map((i) => i.id)).toEqual(["a"]);
  });

  it("filters by status", () => {
    const items = [item({ id: "a", status: "answered" }), item({ id: "b", status: "insufficient_evidence" })];
    const result = filterHistoryListItems(items, { ...DEFAULT_HISTORY_LIST_FILTERS, status: "insufficient_evidence" }, NOW);
    expect(result.map((i) => i.id)).toEqual(["b"]);
  });

  it("filters by recency group", () => {
    const items = [
      item({ id: "today", createdAt: new Date(2026, 0, 15, 8, 0, 0).toISOString() }),
      item({ id: "older", createdAt: new Date(2025, 11, 1, 8, 0, 0).toISOString() }),
    ];
    const result = filterHistoryListItems(items, { ...DEFAULT_HISTORY_LIST_FILTERS, group: "older" }, NOW);
    expect(result.map((i) => i.id)).toEqual(["older"]);
  });

  it("combines filters with AND semantics", () => {
    const items = [
      item({ id: "match", query: "wypowiedzenie umowy", status: "answered" }),
      item({ id: "wrong-status", query: "wypowiedzenie umowy", status: "insufficient_evidence" }),
      item({ id: "wrong-query", query: "coś innego", status: "answered" }),
    ];
    const filters: HistoryListFilters = { searchTerm: "wypowiedzenie", status: "answered", group: "all" };
    expect(filterHistoryListItems(items, filters, NOW).map((i) => i.id)).toEqual(["match"]);
  });
});
