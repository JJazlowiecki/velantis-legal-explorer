/**
 * Static, deterministic demo data for /explorer/legal-acts. This page is a UI concept only —
 * status/currentness values here are illustrative fixtures, never a claim about real, current
 * Polish or EU law. The real indexed corpus lives entirely outside this demo data.
 */
export type LegalActJurisdiction = "PL" | "EU";
export type LegalActStatus = "in_force" | "amended" | "repealed";

export const LEGAL_ACT_STATUS_LABELS: Record<LegalActStatus, string> = {
  in_force: "Obowiązujący",
  amended: "Nowelizowany",
  repealed: "Uchylony",
};

export const LEGAL_ACT_CATEGORIES = [
  "Prawo cywilne",
  "Prawo karne",
  "Prawo pracy",
  "Prawo administracyjne",
  "Prawo gospodarcze",
  "Prawo UE",
] as const;

export type LegalActCategory = (typeof LEGAL_ACT_CATEGORIES)[number];

export interface LegalActTocEntry {
  label: string;
}

export interface LegalActRecord {
  id: string;
  title: string;
  jurisdiction: LegalActJurisdiction;
  category: LegalActCategory;
  actType: string;
  publication: string;
  status: LegalActStatus;
  lastChange: string;
  legalStateDate: string;
  frequentlyUsed: boolean;
  tableOfContents: LegalActTocEntry[];
}

/** Extracts the four-digit publication year embedded in the `publication` label (e.g. "Dz.U. 1964 nr 16 poz. 93" → 1964). */
export function getPublicationYear(publication: string): number | null {
  const match = /\b(1[89]\d{2}|20\d{2})\b/.exec(publication);
  return match ? Number(match[0]) : null;
}

export const DEMO_LEGAL_ACTS: LegalActRecord[] = [
  {
    id: "kc",
    title: "Kodeks cywilny",
    jurisdiction: "PL",
    category: "Prawo cywilne",
    actType: "Ustawa",
    publication: "Dz.U. 1964 nr 16 poz. 93",
    status: "amended",
    lastChange: "2025-10-12",
    legalStateDate: "2026-01-01",
    frequentlyUsed: true,
    tableOfContents: [
      { label: "Księga pierwsza — Część ogólna" },
      { label: "Księga trzecia — Zobowiązania" },
      { label: "Księga czwarta — Spadki" },
    ],
  },
  {
    id: "kpc",
    title: "Kodeks postępowania cywilnego",
    jurisdiction: "PL",
    category: "Prawo cywilne",
    actType: "Ustawa",
    publication: "Dz.U. 1964 nr 43 poz. 296",
    status: "amended",
    lastChange: "2025-09-01",
    legalStateDate: "2026-01-01",
    frequentlyUsed: true,
    tableOfContents: [{ label: "Część pierwsza — Postępowanie rozpoznawcze" }, { label: "Część druga — Postępowanie zabezpieczające" }],
  },
  {
    id: "kp",
    title: "Kodeks pracy",
    jurisdiction: "PL",
    category: "Prawo pracy",
    actType: "Ustawa",
    publication: "Dz.U. 1974 nr 24 poz. 141",
    status: "amended",
    lastChange: "2025-11-20",
    legalStateDate: "2026-01-01",
    frequentlyUsed: true,
    tableOfContents: [{ label: "Dział drugi — Stosunek pracy" }, { label: "Dział ósmy — Uprawnienia pracowników związane z rodzicielstwem" }],
  },
  {
    id: "kpa",
    title: "Kodeks postępowania administracyjnego",
    jurisdiction: "PL",
    category: "Prawo administracyjne",
    actType: "Ustawa",
    publication: "Dz.U. 1960 nr 30 poz. 168",
    status: "amended",
    lastChange: "2025-06-15",
    legalStateDate: "2026-01-01",
    frequentlyUsed: true,
    tableOfContents: [{ label: "Dział I — Przepisy ogólne" }, { label: "Dział II — Postępowanie" }],
  },
  {
    id: "kk",
    title: "Kodeks karny",
    jurisdiction: "PL",
    category: "Prawo karne",
    actType: "Ustawa",
    publication: "Dz.U. 1997 nr 88 poz. 553",
    status: "amended",
    lastChange: "2025-08-04",
    legalStateDate: "2026-01-01",
    frequentlyUsed: false,
    tableOfContents: [{ label: "Część ogólna" }, { label: "Część szczególna" }],
  },
  {
    id: "ksh",
    title: "Kodeks spółek handlowych",
    jurisdiction: "PL",
    category: "Prawo gospodarcze",
    actType: "Ustawa",
    publication: "Dz.U. 2000 nr 94 poz. 1037",
    status: "amended",
    lastChange: "2025-05-22",
    legalStateDate: "2026-01-01",
    frequentlyUsed: false,
    tableOfContents: [{ label: "Tytuł I — Przepisy ogólne" }, { label: "Tytuł II — Spółki osobowe" }],
  },
  {
    id: "ustawa-konsument",
    title: "Ustawa o prawach konsumenta",
    jurisdiction: "PL",
    category: "Prawo cywilne",
    actType: "Ustawa",
    publication: "Dz.U. 2014 poz. 827",
    status: "in_force",
    lastChange: "2025-01-10",
    legalStateDate: "2026-01-01",
    frequentlyUsed: false,
    tableOfContents: [{ label: "Rozdział 1 — Przepisy ogólne" }, { label: "Rozdział 4 — Odstąpienie od umowy" }],
  },
  {
    id: "gdpr",
    title: "Rozporządzenie (UE) 2016/679 (RODO)",
    jurisdiction: "EU",
    category: "Prawo UE",
    actType: "Rozporządzenie",
    publication: "Dz.Urz. UE L 119/1",
    status: "in_force",
    lastChange: "2025-02-14",
    legalStateDate: "2026-01-01",
    frequentlyUsed: true,
    tableOfContents: [{ label: "Rozdział I — Przepisy ogólne" }, { label: "Rozdział III — Prawa osoby, której dane dotyczą" }],
  },
];
