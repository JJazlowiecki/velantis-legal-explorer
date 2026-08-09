export type HistoryGroup = "today" | "yesterday" | "this_week" | "older";

export const HISTORY_GROUP_LABELS: Record<HistoryGroup, string> = {
  today: "Dzisiaj",
  yesterday: "Wczoraj",
  this_week: "Ten tydzień",
  older: "Starsze",
};

export const HISTORY_GROUP_ORDER: HistoryGroup[] = ["today", "yesterday", "this_week", "older"];

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Pure, injectable `now` for deterministic tests — classifies a timestamp into a recency bucket relative to `now`. */
export function classifyHistoryGroup(createdAt: Date, now: Date = new Date()): HistoryGroup {
  const dayDiff = Math.round((startOfDay(now).getTime() - startOfDay(createdAt).getTime()) / (24 * 60 * 60 * 1000));

  if (dayDiff <= 0) return "today";
  if (dayDiff === 1) return "yesterday";
  if (dayDiff <= 7) return "this_week";
  return "older";
}
