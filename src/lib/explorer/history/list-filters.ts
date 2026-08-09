import { classifyHistoryGroup, type HistoryGroup } from "./grouping";
import type { HistoryListItem } from "./list-view";
import type { ExplorerHistoryStatus } from "./snapshot";

export interface HistoryListFilters {
  searchTerm: string;
  status: ExplorerHistoryStatus | "all";
  group: HistoryGroup | "all";
}

export const DEFAULT_HISTORY_LIST_FILTERS: HistoryListFilters = {
  searchTerm: "",
  status: "all",
  group: "all",
};

/** Pure client-side filter over an already-loaded, bounded history list. */
export function filterHistoryListItems(items: HistoryListItem[], filters: HistoryListFilters, now: Date = new Date()): HistoryListItem[] {
  const term = filters.searchTerm.trim().toLowerCase();

  return items.filter((item) => {
    if (filters.status !== "all" && item.status !== filters.status) {
      return false;
    }

    if (filters.group !== "all" && classifyHistoryGroup(new Date(item.createdAt), now) !== filters.group) {
      return false;
    }

    if (term.length > 0 && !item.query.toLowerCase().includes(term)) {
      return false;
    }

    return true;
  });
}
