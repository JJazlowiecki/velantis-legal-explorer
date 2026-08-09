import type { SavedItem, SavedItemType } from "./saved";

export type SavedTab = "all" | SavedItemType;

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

export interface SavedFilters {
  tab: SavedTab;
  searchTerm: string;
  sort: SavedSort;
  folderId: string | null | "all";
}

export const DEFAULT_SAVED_FILTERS: SavedFilters = {
  tab: "all",
  searchTerm: "",
  sort: "date_desc",
  folderId: "all",
};

/** Pure client-side filter + sort over the static demo saved-items list. */
export function filterAndSortSavedItems(items: SavedItem[], filters: SavedFilters): SavedItem[] {
  const term = filters.searchTerm.trim().toLowerCase();

  const filtered = items.filter((item) => {
    if (filters.tab !== "all" && item.type !== filters.tab) {
      return false;
    }

    if (filters.folderId !== "all" && item.folderId !== filters.folderId) {
      return false;
    }

    if (term.length > 0 && !item.title.toLowerCase().includes(term)) {
      return false;
    }

    return true;
  });

  const sorted = [...filtered];
  sorted.sort((a, b) => {
    switch (filters.sort) {
      case "date_asc":
        return a.savedDate.localeCompare(b.savedDate);
      case "title_asc":
        return a.title.localeCompare(b.title);
      case "date_desc":
      default:
        return b.savedDate.localeCompare(a.savedDate);
    }
  });

  return sorted;
}
