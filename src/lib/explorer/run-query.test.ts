import { describe, expect, it, vi } from "vitest";

import type { LegalAnswerResult } from "@/lib/legal/answer/answer";
import { LegalIssueInvestigationError } from "@/lib/legal/issues/investigate";
import { ExplorerConfigError } from "./corpus-config";
import { runExplorerQuery, type RunExplorerQueryDeps } from "./run-query";

const VALID_UUID = "572d313e-ae03-4207-97c6-38e2e5088617";

function baseResult(overrides: Partial<LegalAnswerResult> = {}): LegalAnswerResult {
  return {
    status: "answered",
    problemDescription: "opis problemu",
    legalActVersionIds: [VALID_UUID],
    answer: "Odpowiedź.",
    conclusions: [],
    alternativePaths: [],
    uncertainties: [],
    clarificationQuestion: null,
    sources: [],
    ...overrides,
  };
}

function fakeDeps(overrides: Partial<RunExplorerQueryDeps> = {}): RunExplorerQueryDeps {
  return {
    getLegalActVersionIds: () => [VALID_UUID],
    answerLegalProblem: vi.fn().mockResolvedValue(baseResult()),
    getDb: () => undefined,
    ...overrides,
  };
}

describe("runExplorerQuery", () => {
  it("rejects blank input without calling the pipeline", async () => {
    const deps = fakeDeps();
    const result = await runExplorerQuery("   ", deps);

    expect(result).toEqual({ ok: false, error: expect.any(String) });
    expect(deps.answerLegalProblem).not.toHaveBeenCalled();
  });

  it("rejects a non-string input without calling the pipeline", async () => {
    const deps = fakeDeps();
    const result = await runExplorerQuery(undefined, deps);

    expect(result.ok).toBe(false);
    expect(deps.answerLegalProblem).not.toHaveBeenCalled();
  });

  it("maps a successful answered result to the sanitized view model", async () => {
    const deps = fakeDeps({
      answerLegalProblem: vi.fn().mockResolvedValue(
        baseResult({
          status: "answered",
          answer: "Możesz złożyć skargę na urzędnika (art. 162 § 2).",
        }),
      ),
    });

    const result = await runExplorerQuery("urzędnik nie wie do kogo mam się zwrócić", deps);

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        status: "answered",
        answer: "Możesz złożyć skargę na urzędnika (art. 162 § 2).",
      }),
    });
  });

  it("maps an insufficient_evidence result distinctly from an answered result", async () => {
    const deps = fakeDeps({
      answerLegalProblem: vi.fn().mockResolvedValue(
        baseResult({
          status: "insufficient_evidence",
          answer: "Dostępne źródła nie są wystarczające.",
        }),
      ),
    });

    const result = await runExplorerQuery("sąsiad wyciął moje drzewo", deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("insufficient_evidence");
      expect(result.data.answer).toBe("Dostępne źródła nie są wystarczające.");
    }
  });

  it("passes the trimmed query and configured legalActVersionIds through to answerLegalProblem", async () => {
    const answerLegalProblem = vi.fn().mockResolvedValue(baseResult());
    const deps = fakeDeps({ answerLegalProblem, getLegalActVersionIds: () => [VALID_UUID] });

    await runExplorerQuery("  jakiś problem prawny  ", deps);

    expect(answerLegalProblem).toHaveBeenCalledWith(
      expect.objectContaining({ problemDescription: "jakiś problem prawny", legalActVersionIds: [VALID_UUID] }),
    );
  });

  it("maps a missing test-corpus configuration error to a safe result without leaking the raw message", async () => {
    const deps = fakeDeps({
      getLegalActVersionIds: () => {
        throw new ExplorerConfigError("EXPLORER_TEST_LEGAL_ACT_VERSION_IDS is not configured");
      },
    });

    const result = await runExplorerQuery("jakiś problem prawny", deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("EXPLORER_TEST_LEGAL_ACT_VERSION_IDS");
    }
  });

  it("maps a pipeline error (e.g. investigation failure) to a safe result without leaking internals", async () => {
    const deps = fakeDeps({
      answerLegalProblem: vi.fn().mockRejectedValue(new LegalIssueInvestigationError("legalActVersionIds is required")),
    });

    const result = await runExplorerQuery("jakiś problem prawny", deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("legalActVersionIds");
      expect(typeof result.error).toBe("string");
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it("maps an unexpected/unknown error to a safe generic result", async () => {
    const deps = fakeDeps({
      answerLegalProblem: vi.fn().mockRejectedValue(new Error("relation \"legal_acts\" does not exist")),
    });

    const result = await runExplorerQuery("jakiś problem prawny", deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("relation");
      expect(result.error).not.toContain("legal_acts");
    }
  });

  it("never throws, even when the pipeline throws synchronously or asynchronously", async () => {
    const deps = fakeDeps({
      answerLegalProblem: vi.fn().mockImplementation(() => {
        throw new Error("synchronous boom");
      }),
    });

    await expect(runExplorerQuery("jakiś problem prawny", deps)).resolves.toMatchObject({ ok: false });
  });

  describe("history recording", () => {
    it("records history for an answered result", async () => {
      const recordHistoryEntry = vi.fn().mockResolvedValue({ id: "fake-history-entry-id" });
      const deps = fakeDeps({
        answerLegalProblem: vi.fn().mockResolvedValue(baseResult({ status: "answered" })),
        recordHistoryEntry,
      });

      await runExplorerQuery("jakiś problem prawny", deps);

      expect(recordHistoryEntry).toHaveBeenCalledTimes(1);
      expect(recordHistoryEntry).toHaveBeenCalledWith(
        expect.objectContaining({ query: "jakiś problem prawny", result: expect.objectContaining({ status: "answered" }) }),
      );
    });

    it("records history for an insufficient_evidence result", async () => {
      const recordHistoryEntry = vi.fn().mockResolvedValue({ id: "fake-history-entry-id" });
      const deps = fakeDeps({
        answerLegalProblem: vi.fn().mockResolvedValue(baseResult({ status: "insufficient_evidence" })),
        recordHistoryEntry,
      });

      await runExplorerQuery("jakiś problem prawny", deps);

      expect(recordHistoryEntry).toHaveBeenCalledTimes(1);
      expect(recordHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ status: "insufficient_evidence" }) }));
    });

    it("does not record history when the pipeline errors before producing a result", async () => {
      const recordHistoryEntry = vi.fn().mockResolvedValue({ id: "fake-history-entry-id" });
      const deps = fakeDeps({
        answerLegalProblem: vi.fn().mockRejectedValue(new LegalIssueInvestigationError("boom")),
        recordHistoryEntry,
      });

      await runExplorerQuery("jakiś problem prawny", deps);

      expect(recordHistoryEntry).not.toHaveBeenCalled();
    });

    it("does not record history when input validation fails", async () => {
      const recordHistoryEntry = vi.fn().mockResolvedValue({ id: "fake-history-entry-id" });
      const deps = fakeDeps({ recordHistoryEntry });

      await runExplorerQuery("", deps);

      expect(recordHistoryEntry).not.toHaveBeenCalled();
      expect(deps.answerLegalProblem).not.toHaveBeenCalled();
    });

    it("does not attempt to record history when recordHistoryEntry is undefined (history disabled)", async () => {
      const deps = fakeDeps({ recordHistoryEntry: undefined });
      const result = await runExplorerQuery("jakiś problem prawny", deps);
      expect(result.ok).toBe(true);
    });

    it("a history write failure does not change the returned result — the user still gets their answer", async () => {
      const recordHistoryEntry = vi.fn().mockRejectedValue(new Error("db connection lost"));
      const deps = fakeDeps({
        answerLegalProblem: vi.fn().mockResolvedValue(baseResult({ status: "answered", answer: "Prawdziwa odpowiedź." })),
        recordHistoryEntry,
      });

      const result = await runExplorerQuery("jakiś problem prawny", deps);

      expect(recordHistoryEntry).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: true, data: expect.objectContaining({ status: "answered", answer: "Prawdziwa odpowiedź." }) });
      expect((result as { historyEntryId?: string }).historyEntryId).toBeUndefined();
    });

    it("includes the returned historyEntryId in the result so callers can Save from it without resending answer JSON", async () => {
      const recordHistoryEntry = vi.fn().mockResolvedValue({ id: "real-history-entry-id" });
      const deps = fakeDeps({
        answerLegalProblem: vi.fn().mockResolvedValue(baseResult({ status: "answered" })),
        recordHistoryEntry,
      });

      const result = await runExplorerQuery("jakiś problem prawny", deps);

      expect(result.ok).toBe(true);
      expect((result as { historyEntryId?: string }).historyEntryId).toBe("real-history-entry-id");
    });

    it("omits historyEntryId when history recording is disabled", async () => {
      const deps = fakeDeps({ recordHistoryEntry: undefined });
      const result = await runExplorerQuery("jakiś problem prawny", deps);

      expect(result.ok).toBe(true);
      expect((result as { historyEntryId?: string }).historyEntryId).toBeUndefined();
    });
  });
});
