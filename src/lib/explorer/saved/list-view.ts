import type { SavedItemRecord } from "./service";
import type { SavedItemKind } from "./snapshot";

/**
 * Client-safe view model for one Saved list row — deliberately excludes anything internal
 * (no visitor id, no raw snapshot dump beyond what a preview needs). `sourceOrStatus` mirrors
 * the demo UI's column of the same purpose: a short human-readable summary distinct per kind.
 */
export interface SavedListItem {
  id: string;
  kind: SavedItemKind;
  title: string;
  query: string | null;
  folderId: string | null;
  createdAt: string;
  sourceOrStatus: string;
}

function summarize(record: SavedItemRecord): string {
  switch (record.kind) {
    case "answer": {
      const snapshot = record.snapshot as { citedSources: unknown[]; status: string };
      const count = snapshot.citedSources.length;
      return snapshot.status === "answered"
        ? `${count} ${count === 1 ? "źródło" : "źródeł"}`
        : "Brak wystarczających źródeł";
    }
    case "provision": {
      const snapshot = record.snapshot as { isNonAuthoritative: boolean; isCurrentnessUnproven: boolean };
      if (snapshot.isNonAuthoritative) return "nieautorytatywny";
      if (snapshot.isCurrentnessUnproven) return "aktualność niepotwierdzona";
      return "przepis";
    }
    case "search":
      return "zapisane wyszukiwanie";
  }
}

export function toSavedListItem(record: SavedItemRecord): SavedListItem {
  return {
    id: record.id,
    kind: record.kind,
    title: record.title,
    query: record.query,
    folderId: record.folderId,
    createdAt: record.createdAt.toISOString(),
    sourceOrStatus: summarize(record),
  };
}
