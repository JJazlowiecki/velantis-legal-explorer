import type { HistoryEntry, HistoryEntryType, HistoryGroup } from "./history";

export interface HistoryFilters {
  searchTerm: string;
  type: HistoryEntryType | "all";
  group: HistoryGroup | "all";
}

export const DEFAULT_HISTORY_FILTERS: HistoryFilters = {
  searchTerm: "",
  type: "all",
  group: "all",
};

/** Pure client-side filter over the static demo history list — no persistence, no network. */
export function filterHistoryEntries(entries: HistoryEntry[], filters: HistoryFilters): HistoryEntry[] {
  const term = filters.searchTerm.trim().toLowerCase();

  return entries.filter((entry) => {
    if (filters.type !== "all" && entry.type !== filters.type) {
      return false;
    }

    if (filters.group !== "all" && entry.group !== filters.group) {
      return false;
    }

    if (term.length > 0 && !entry.title.toLowerCase().includes(term)) {
      return false;
    }

    return true;
  });
}

export type HistoryClearScope = "all" | "last_7_days" | "last_30_days" | "custom";

export interface HistoryClearSelection {
  scope: HistoryClearScope;
  preserveSaved: boolean;
}

export const DEFAULT_HISTORY_CLEAR_SELECTION: HistoryClearSelection = {
  scope: "all",
  preserveSaved: true,
};
