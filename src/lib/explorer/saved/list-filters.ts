import type { SavedListItem } from "./list-view";

/**
 * "act" is deliberately kept as a tab even though no real SavedListItem can ever have
 * kind "act" (SavedItemKind only has answer/search/provision) — selecting it always yields
 * the honest empty state until real Legal Acts persistence exists, with no special-casing
 * needed here: the filter below just never matches.
 */
export type SavedTab = "all" | "answer" | "provision" | "act" | "search";

export const SAVED_TAB_LABELS: Record<SavedTab, string> = {
  all: "Wszystkie",
  answer: "Odpowiedzi",
  provision: "Przepisy",
  act: "Akty prawne",
  search: "Wyszukiwania",
};

export const SAVED_TABS: SavedTab[] = ["all", "answer", "provision", "act", "search"];

export type SavedSort = "date_desc" | "date_asc" | "title_asc";

export const SAVED_SORT_LABELS: Record<SavedSort, string> = {
  date_desc: "Data zapisu: najnowsze",
  date_asc: "Data zapisu: najstarsze",
  title_asc: "Nazwa: A–Z",
};

export interface SavedListFilters {
  tab: SavedTab;
  searchTerm: string;
  sort: SavedSort;
  folderId: string | null | "all";
}

export const DEFAULT_SAVED_LIST_FILTERS: SavedListFilters = {
  tab: "all",
  searchTerm: "",
  sort: "date_desc",
  folderId: "all",
};

/** Pure client-side filter + sort over an already-loaded, bounded Saved list. */
export function filterAndSortSavedListItems(items: SavedListItem[], filters: SavedListFilters): SavedListItem[] {
  const term = filters.searchTerm.trim().toLowerCase();

  const filtered = items.filter((item) => {
    if (filters.tab !== "all" && item.kind !== filters.tab) {
      return false;
    }

    if (filters.folderId !== "all" && item.folderId !== filters.folderId) {
      return false;
    }

    if (term.length > 0) {
      const haystack = `${item.title} ${item.query ?? ""}`.toLowerCase();
      if (!haystack.includes(term)) {
        return false;
      }
    }

    return true;
  });

  const sorted = [...filtered];
  sorted.sort((a, b) => {
    switch (filters.sort) {
      case "date_asc":
        return a.createdAt.localeCompare(b.createdAt);
      case "title_asc":
        return a.title.localeCompare(b.title);
      case "date_desc":
      default:
        return b.createdAt.localeCompare(a.createdAt);
    }
  });

  return sorted;
}
