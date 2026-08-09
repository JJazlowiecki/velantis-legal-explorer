/** Static, deterministic demo data for /explorer/saved — not backed by any persistence. */
export type SavedItemType = "answer" | "provision" | "act" | "search";

export interface SavedFolder {
  id: string;
  name: string;
  itemCount: number;
}

export interface SavedItem {
  id: string;
  type: SavedItemType;
  title: string;
  savedDate: string;
  legalStateDate: string;
  sourceOrStatus: string;
  folderId: string | null;
}

export const DEMO_SAVED_FOLDERS: SavedFolder[] = [
  { id: "f-labor", name: "Prawo pracy", itemCount: 3 },
  { id: "f-contracts", name: "Umowy", itemCount: 2 },
  { id: "f-liability", name: "Odpowiedzialność cywilna", itemCount: 2 },
];

export const DEMO_SAVED_ITEMS: SavedItem[] = [
  {
    id: "s1",
    type: "answer",
    title: "Termin odwołania od wypowiedzenia umowy o pracę",
    savedDate: "2025-12-30",
    legalStateDate: "2025-12-28",
    sourceOrStatus: "2 źródła",
    folderId: "f-labor",
  },
  {
    id: "s2",
    type: "provision",
    title: "Art. 30 Kodeksu pracy",
    savedDate: "2025-12-29",
    legalStateDate: "2025-12-28",
    sourceOrStatus: "obowiązujący",
    folderId: "f-labor",
  },
  {
    id: "s3",
    type: "answer",
    title: "Wypowiedzenie zmieniające warunki pracy",
    savedDate: "2025-12-20",
    legalStateDate: "2025-12-18",
    sourceOrStatus: "3 źródła",
    folderId: "f-labor",
  },
  {
    id: "s4",
    type: "answer",
    title: "Odpowiedzialność za niewykonanie umowy remontowej",
    savedDate: "2025-12-31",
    legalStateDate: "2025-12-30",
    sourceOrStatus: "4 źródła",
    folderId: "f-contracts",
  },
  {
    id: "s5",
    type: "act",
    title: "Kodeks cywilny",
    savedDate: "2025-12-15",
    legalStateDate: "2026-01-01",
    sourceOrStatus: "tekst jednolity",
    folderId: "f-contracts",
  },
  {
    id: "s6",
    type: "provision",
    title: "Art. 471 Kodeksu cywilnego",
    savedDate: "2025-12-14",
    legalStateDate: "2026-01-01",
    sourceOrStatus: "obowiązujący",
    folderId: "f-liability",
  },
  {
    id: "s7",
    type: "answer",
    title: "Odpowiedzialność sprzedawcy z tytułu rękojmi",
    savedDate: "2025-12-10",
    legalStateDate: "2025-12-05",
    sourceOrStatus: "3 źródła",
    folderId: "f-liability",
  },
  {
    id: "s8",
    type: "search",
    title: "przedawnienie roszczeń z faktury",
    savedDate: "2025-12-01",
    legalStateDate: "2025-11-28",
    sourceOrStatus: "zapisane wyszukiwanie",
    folderId: null,
  },
];
