/**
 * Static, deterministic demo data for /explorer/history. Never derived from the real
 * legal-answer pipeline or a database — purely fixtures for the history UI concept.
 */
export type HistoryEntryType = "answer" | "provision";
export type HistoryGroup = "today" | "yesterday" | "this_week" | "older";

export interface HistoryEntry {
  id: string;
  type: HistoryEntryType;
  title: string;
  group: HistoryGroup;
  timeLabel: string;
  sourceCount: number;
  legalStateDate: string;
  answerPreview: string;
}

export const HISTORY_GROUP_LABELS: Record<HistoryGroup, string> = {
  today: "Dzisiaj",
  yesterday: "Wczoraj",
  this_week: "Ten tydzień",
  older: "Starsze",
};

export const HISTORY_GROUP_ORDER: HistoryGroup[] = ["today", "yesterday", "this_week", "older"];

export const DEMO_HISTORY_ENTRIES: HistoryEntry[] = [
  {
    id: "h1",
    type: "answer",
    title: "Kiedy przedawnia się roszczenie o zapłatę z faktury?",
    group: "today",
    timeLabel: "dzisiaj, 14:32",
    sourceCount: 3,
    legalStateDate: "2026-01-01",
    answerPreview:
      "Roszczenia związane z prowadzeniem działalności gospodarczej przedawniają się z upływem trzech lat, chyba że przepis szczególny stanowi inaczej.",
  },
  {
    id: "h2",
    type: "provision",
    title: "Art. 471 Kodeksu cywilnego",
    group: "today",
    timeLabel: "dzisiaj, 11:05",
    sourceCount: 1,
    legalStateDate: "2026-01-01",
    answerPreview: "Dłużnik obowiązany jest do naprawienia szkody wynikłej z niewykonania lub nienależytego wykonania zobowiązania.",
  },
  {
    id: "h3",
    type: "answer",
    title: "Odpowiedzialność za niewykonanie umowy remontowej",
    group: "yesterday",
    timeLabel: "wczoraj, 18:47",
    sourceCount: 4,
    legalStateDate: "2025-12-30",
    answerPreview:
      "Wykonawca odpowiada za nienależyte wykonanie umowy, w tym za wady w wykonanych pracach, na zasadach ogólnych odpowiedzialności kontraktowej.",
  },
  {
    id: "h4",
    type: "answer",
    title: "Termin odwołania od wypowiedzenia umowy o pracę",
    group: "this_week",
    timeLabel: "poniedziałek, 09:12",
    sourceCount: 2,
    legalStateDate: "2025-12-28",
    answerPreview: "Odwołanie od wypowiedzenia umowy o pracę wnosi się do sądu pracy w terminie 21 dni od dnia doręczenia wypowiedzenia.",
  },
  {
    id: "h5",
    type: "provision",
    title: "Art. 233 Kodeksu postępowania cywilnego",
    group: "this_week",
    timeLabel: "wtorek, 16:20",
    sourceCount: 1,
    legalStateDate: "2025-12-28",
    answerPreview: "Sąd ocenia wiarygodność i moc dowodów według własnego przekonania, na podstawie wszechstronnego rozważenia zebranego materiału.",
  },
  {
    id: "h6",
    type: "answer",
    title: "Przesłanki zasiedzenia nieruchomości",
    group: "older",
    timeLabel: "3 grudnia",
    sourceCount: 5,
    legalStateDate: "2025-11-15",
    answerPreview: "Zasiedzenie nieruchomości wymaga samoistnego posiadania przez okres 20 lub 30 lat, w zależności od dobrej lub złej wiary posiadacza.",
  },
  {
    id: "h7",
    type: "answer",
    title: "Zwrot towaru zakupionego przez internet",
    group: "older",
    timeLabel: "18 listopada",
    sourceCount: 2,
    legalStateDate: "2025-11-01",
    answerPreview: "Konsument może odstąpić od umowy zawartej na odległość w terminie 14 dni bez podawania przyczyny, z zastrzeżonymi wyjątkami.",
  },
];
