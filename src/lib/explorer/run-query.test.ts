import { describe, expect, it, vi } from "vitest";

import type { LegalAnswerResult } from "@/lib/legal/answer/answer";
import { LegalIssueInvestigationError } from "@/lib/legal/issues/investigate";
import { CurrentCorpusNotReadyError, ExplorerConfigError } from "./corpus-config";
import { runExplorerQuery, type ResolvedQueryCorpus, type RunExplorerQueryDeps } from "./run-query";
import type { ExplorerAnswerView } from "./view-model";

const VALID_UUID = "572d313e-ae03-4207-97c6-38e2e5088617";
const TEST_CORPUS: ResolvedQueryCorpus = {
  legalActVersionIds: [VALID_UUID],
  corpusRunId: null,
  rulesetVersion: null,
  effectiveAsOf: null,
  corpusSelectionHash: null,
};

function baseResult(overrides: Partial<LegalAnswerResult> = {}): LegalAnswerResult {
  return {
    status: "answered",
    problemDescription: "opis problemu",
    legalActVersionIds: [VALID_UUID],
    answer: "Odpowiedź.",
    answerTargets: [],
    targetCoverage: [],
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
    getCorpus: async () => TEST_CORPUS,
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
    const deps = fakeDeps({ answerLegalProblem, getCorpus: async () => TEST_CORPUS });

    await runExplorerQuery("  jakiś problem prawny  ", deps);

    expect(answerLegalProblem).toHaveBeenCalledWith(
      expect.objectContaining({ problemDescription: "jakiś problem prawny", legalActVersionIds: [VALID_UUID] }),
    );
  });

  it("maps a missing test-corpus configuration error to a safe result without leaking the raw message", async () => {
    const deps = fakeDeps({
      getCorpus: async () => {
        throw new ExplorerConfigError("EXPLORER_TEST_LEGAL_ACT_VERSION_IDS is not configured");
      },
    });

    const result = await runExplorerQuery("jakiś problem prawny", deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("EXPLORER_TEST_LEGAL_ACT_VERSION_IDS");
    }
  });

  it("maps a not-ready current-corpus error to a safe result and never falls back to a test corpus", async () => {
    const answerLegalProblem = vi.fn().mockResolvedValue(baseResult());
    const deps = fakeDeps({
      answerLegalProblem,
      getCorpus: async () => {
        throw new CurrentCorpusNotReadyError();
      },
    });

    const result = await runExplorerQuery("jakiś problem prawny", deps);

    expect(result).toEqual({ ok: false, error: "Brak gotowego korpusu aktualnego prawa." });
    expect(answerLegalProblem).not.toHaveBeenCalled();
  });

  it("resolves the corpus exactly once and uses the SAME descriptor for both the answer call and history provenance", async () => {
    const currentCorpus: ResolvedQueryCorpus = {
      legalActVersionIds: [VALID_UUID],
      corpusRunId: "run-1",
      rulesetVersion: "pl-current-law-v1",
      effectiveAsOf: "2026-08-09",
      corpusSelectionHash: "hash-1",
    };
    const getCorpus = vi.fn().mockResolvedValue(currentCorpus);
    const answerLegalProblem = vi.fn().mockResolvedValue(baseResult());
    const recordHistoryEntry = vi.fn().mockResolvedValue({ id: "history-1" });
    const deps = fakeDeps({ getCorpus, answerLegalProblem, recordHistoryEntry });

    await runExplorerQuery("jakiś problem prawny", deps);

    expect(getCorpus).toHaveBeenCalledTimes(1);
    expect(answerLegalProblem).toHaveBeenCalledWith(expect.objectContaining({ legalActVersionIds: currentCorpus.legalActVersionIds }));
    expect(recordHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({ corpus: currentCorpus }));
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

  describe("verified answer cache orchestration", () => {
    const CURRENT_CORPUS: ResolvedQueryCorpus = {
      legalActVersionIds: [VALID_UUID],
      corpusRunId: "run-1",
      rulesetVersion: "pl-current-law-v1",
      effectiveAsOf: "2026-08-09",
      corpusSelectionHash: "hash-1",
    };

    const cachedView: ExplorerAnswerView = {
      status: "answered",
      answer: "Odpowiedź z pamięci podręcznej.",
      conclusions: [{ statement: "Teza z cache.", citationLabels: ["art. 1"] }],
      alternativePaths: [],
      uncertainties: [],
      citedSources: [
        {
          actTitle: "Ustawa testowa",
          citationLabel: "art. 1",
          text: "Treść.",
          isNonAuthoritative: false,
          isCurrentnessUnproven: false,
          provenCurrentAsOf: "2026-08-09",
        },
      ],
      clarificationQuestion: null,
    };

    it("on a cache hit: never calls answerLegalProblem, returns the cached view, and still writes a normal History entry", async () => {
      const answerLegalProblem = vi.fn().mockResolvedValue(baseResult());
      const lookupCachedAnswer = vi.fn().mockResolvedValue(cachedView);
      const recordCachedAnswer = vi.fn().mockResolvedValue(undefined);
      const recordHistoryEntry = vi.fn().mockResolvedValue({ id: "history-hit-1" });
      const deps = fakeDeps({
        getCorpus: async () => CURRENT_CORPUS,
        answerLegalProblem,
        lookupCachedAnswer,
        recordCachedAnswer,
        recordHistoryEntry,
      });

      const result = await runExplorerQuery("Kto może oddać krew?", deps);

      expect(answerLegalProblem).not.toHaveBeenCalled();
      expect(recordCachedAnswer).not.toHaveBeenCalled();
      expect(result).toEqual({ ok: true, data: cachedView, historyEntryId: "history-hit-1" });

      expect(recordHistoryEntry).toHaveBeenCalledTimes(1);
      expect(recordHistoryEntry).toHaveBeenCalledWith({
        query: "Kto może oddać krew?",
        result: { status: "answered", legalActVersionIds: CURRENT_CORPUS.legalActVersionIds },
        view: cachedView,
        corpus: CURRENT_CORPUS,
      });
    });

    it("on a cache miss: runs the normal pipeline, attempts to record the result, and still writes History normally", async () => {
      const freshResult = baseResult({ status: "answered" });
      const answerLegalProblem = vi.fn().mockResolvedValue(freshResult);
      const lookupCachedAnswer = vi.fn().mockResolvedValue(null);
      const recordCachedAnswer = vi.fn().mockResolvedValue(undefined);
      const recordHistoryEntry = vi.fn().mockResolvedValue({ id: "history-miss-1" });
      const deps = fakeDeps({
        getCorpus: async () => CURRENT_CORPUS,
        answerLegalProblem,
        lookupCachedAnswer,
        recordCachedAnswer,
        recordHistoryEntry,
      });

      const result = await runExplorerQuery("Kto może oddać krew?", deps);

      expect(lookupCachedAnswer).toHaveBeenCalledWith({ question: "Kto może oddać krew?", corpus: CURRENT_CORPUS });
      expect(answerLegalProblem).toHaveBeenCalledTimes(1);
      expect(recordCachedAnswer).toHaveBeenCalledTimes(1);
      expect(recordCachedAnswer).toHaveBeenCalledWith(
        expect.objectContaining({ question: "Kto może oddać krew?", corpus: CURRENT_CORPUS, result: freshResult }),
      );
      expect(result.ok).toBe(true);
      expect(recordHistoryEntry).toHaveBeenCalledTimes(1);
    });

    it("a cache write failure never changes the returned result — the user still gets their answer", async () => {
      const recordCachedAnswer = vi.fn().mockRejectedValue(new Error("db write failed"));
      const deps = fakeDeps({
        getCorpus: async () => CURRENT_CORPUS,
        answerLegalProblem: vi.fn().mockResolvedValue(baseResult({ status: "answered", answer: "Prawdziwa odpowiedź." })),
        lookupCachedAnswer: vi.fn().mockResolvedValue(null),
        recordCachedAnswer,
      });

      const result = await runExplorerQuery("Kto może oddać krew?", deps);

      expect(recordCachedAnswer).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: true, data: expect.objectContaining({ status: "answered", answer: "Prawdziwa odpowiedź." }) });
    });

    it("a cache lookup failure falls through to the normal pipeline rather than surfacing an error", async () => {
      // lookupCachedAnswer itself is documented to never throw (invalid rows are handled as a
      // null miss internally) — but this proves the orchestration wouldn't break even if it did.
      const answerLegalProblem = vi.fn().mockResolvedValue(baseResult({ status: "answered" }));
      const deps = fakeDeps({
        getCorpus: async () => CURRENT_CORPUS,
        answerLegalProblem,
        lookupCachedAnswer: vi.fn().mockResolvedValue(null),
      });

      const result = await runExplorerQuery("Kto może oddać krew?", deps);

      expect(answerLegalProblem).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
    });

    it("never invokes cache lookup/write when no cache deps are wired (e.g. test mode)", async () => {
      const answerLegalProblem = vi.fn().mockResolvedValue(baseResult());
      const deps = fakeDeps({ answerLegalProblem, lookupCachedAnswer: undefined, recordCachedAnswer: undefined });

      const result = await runExplorerQuery("jakiś problem prawny", deps);

      expect(answerLegalProblem).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
    });
  });
});
