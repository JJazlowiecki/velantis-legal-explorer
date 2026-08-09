import { getPublicationYear, type LegalActCategory, type LegalActJurisdiction, type LegalActRecord, type LegalActStatus } from "./legal-acts";

export interface LegalActFilters {
  jurisdiction: LegalActJurisdiction;
  searchTerm: string;
  category: LegalActCategory | "all";
  status: LegalActStatus | "all";
  actType: string | "all";
  publicationYear: number | "all";
}

export const DEFAULT_LEGAL_ACT_FILTERS: LegalActFilters = {
  jurisdiction: "PL",
  searchTerm: "",
  category: "all",
  status: "all",
  actType: "all",
  publicationYear: "all",
};

/** Pure client-side filter over the static demo legal-acts list. */
export function filterLegalActs(acts: LegalActRecord[], filters: LegalActFilters): LegalActRecord[] {
  const term = filters.searchTerm.trim().toLowerCase();

  return acts.filter((act) => {
    if (act.jurisdiction !== filters.jurisdiction) {
      return false;
    }

    if (filters.category !== "all" && act.category !== filters.category) {
      return false;
    }

    if (filters.status !== "all" && act.status !== filters.status) {
      return false;
    }

    if (filters.actType !== "all" && act.actType !== filters.actType) {
      return false;
    }

    if (filters.publicationYear !== "all" && getPublicationYear(act.publication) !== filters.publicationYear) {
      return false;
    }

    if (term.length > 0 && !act.title.toLowerCase().includes(term)) {
      return false;
    }

    return true;
  });
}
