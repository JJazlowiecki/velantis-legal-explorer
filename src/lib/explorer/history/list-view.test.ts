import { describe, expect, it } from "vitest";

import type { HistoryEntryRecord } from "./service";
import { toHistoryListItem } from "./list-view";

function record(overrides: Partial<HistoryEntryRecord> = {}): HistoryEntryRecord {
  return {
    id: "h1",
    query: "opis problemu",
    status: "answered",
    corpusVersionIds: ["572d313e-ae03-4207-97c6-38e2e5088617"],
    createdAt: new Date("2026-01-15T10:00:00Z"),
    snapshot: {
      status: "answered",
      answer: "Krótka odpowiedź.",
      conclusions: [],
      alternativePaths: [],
      uncertainties: [],
      citedSources: [
        { actTitle: "Ustawa", citationLabel: "art. 1", text: "Treść", isNonAuthoritative: false, isCurrentnessUnproven: true },
        { actTitle: "Ustawa", citationLabel: "art. 2", text: "Treść", isNonAuthoritative: false, isCurrentnessUnproven: true },
      ],
      clarificationQuestion: null,
    },
    ...overrides,
  };
}

describe("toHistoryListItem", () => {
  it("maps id/query/status/createdAt/sourceCount straight through", () => {
    const item = toHistoryListItem(record());
    expect(item.id).toBe("h1");
    expect(item.query).toBe("opis problemu");
    expect(item.status).toBe("answered");
    expect(item.sourceCount).toBe(2);
    expect(item.createdAt).toBe(new Date("2026-01-15T10:00:00Z").toISOString());
  });

  it("does not truncate a short answer", () => {
    const item = toHistoryListItem(record());
    expect(item.answerPreview).toBe("Krótka odpowiedź.");
  });

  it("truncates a long answer with an ellipsis", () => {
    const longAnswer = "A".repeat(500);
    const item = toHistoryListItem(record({ snapshot: { ...record().snapshot, answer: longAnswer } }));
    expect(item.answerPreview.length).toBeLessThan(longAnswer.length);
    expect(item.answerPreview.endsWith("…")).toBe(true);
  });

  it("never includes internal fields like corpusVersionIds or full snapshot", () => {
    const item = toHistoryListItem(record());
    expect(Object.keys(item).sort()).toEqual(["answerPreview", "createdAt", "id", "query", "sourceCount", "status"].sort());
  });
});
