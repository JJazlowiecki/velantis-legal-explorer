import type { ExplorerHistoryStatus } from "./snapshot";
import type { HistoryEntryRecord } from "./service";

/**
 * Deliberately narrow, like `ExplorerAnswerView`: the /explorer/history LIST only needs
 * enough to render rows and a compact "Szczegóły wyszukiwania" preview. The full snapshot
 * (all sources, full answer text, uncertainties, alternative paths) is fetched separately,
 * only when the visitor opens the dedicated /explorer/history/[id] page.
 */
export interface HistoryListItem {
  id: string;
  query: string;
  status: ExplorerHistoryStatus;
  createdAt: string;
  sourceCount: number;
  answerPreview: string;
}

const PREVIEW_LENGTH = 220;

export function toHistoryListItem(entry: HistoryEntryRecord): HistoryListItem {
  const answer = entry.snapshot.answer;
  return {
    id: entry.id,
    query: entry.query,
    status: entry.status,
    createdAt: entry.createdAt.toISOString(),
    sourceCount: entry.snapshot.citedSources.length,
    answerPreview: answer.length > PREVIEW_LENGTH ? `${answer.slice(0, PREVIEW_LENGTH).trimEnd()}…` : answer,
  };
}
