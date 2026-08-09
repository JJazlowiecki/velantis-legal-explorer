import { describe, expect, it } from "vitest";

import { LegalAnswerError } from "@/lib/legal/answer/answer";
import { FinalAnswerGenerationError } from "@/lib/legal/answer/generate";
import { ConclusionVerificationError } from "@/lib/legal/answer/verify";
import { IssueDetectionError } from "@/lib/legal/issues/detect";
import { LegalIssueInvestigationError } from "@/lib/legal/issues/investigate";
import { EmbeddingError } from "@/lib/legal/search/embeddings";
import { HybridSearchError } from "@/lib/legal/search/service";
import { ExplorerConfigError } from "./corpus-config";
import { mapErrorToSafeMessage } from "./errors";

describe("mapErrorToSafeMessage", () => {
  it("returns a distinct message for missing test-corpus configuration", () => {
    const message = mapErrorToSafeMessage(new ExplorerConfigError("EXPLORER_TEST_LEGAL_ACT_VERSION_IDS is not configured"));
    expect(message).toMatch(/korpusu testowego/i);
  });

  it("returns a distinct message for OpenAI-related failures", () => {
    for (const error of [
      new IssueDetectionError("boom", "HTTP_ERROR"),
      new FinalAnswerGenerationError("boom", "TIMEOUT"),
      new ConclusionVerificationError("boom", "CONFIG"),
    ]) {
      expect(mapErrorToSafeMessage(error)).toMatch(/analizy prawnej/i);
    }
  });

  it("returns a distinct message for search/database failures", () => {
    expect(mapErrorToSafeMessage(new HybridSearchError("boom"))).toMatch(/bazie przepisów/i);
    expect(mapErrorToSafeMessage(new EmbeddingError("boom", "HTTP_ERROR"))).toMatch(/bazie przepisów/i);
  });

  it("returns a distinct message for investigation failures", () => {
    expect(mapErrorToSafeMessage(new LegalIssueInvestigationError("boom"))).toMatch(/przeanalizować/i);
  });

  it("returns a generic message for the defense-in-depth LegalAnswerError and unknown errors", () => {
    expect(mapErrorToSafeMessage(new LegalAnswerError("boom"))).toMatch(/nieoczekiwany błąd/i);
    expect(mapErrorToSafeMessage(new Error("boom"))).toMatch(/nieoczekiwany błąd/i);
    expect(mapErrorToSafeMessage("not even an Error object")).toMatch(/nieoczekiwany błąd/i);
    expect(mapErrorToSafeMessage(undefined)).toMatch(/nieoczekiwany błąd/i);
  });

  it("never leaks the original error message, secrets, or stack traces", () => {
    const secretMessage =
      'connection to postgresql://user:sk-proj-SECRET@127.0.0.1:5432/db failed: relation "legal_acts" does not exist';
    const candidates = [
      new ExplorerConfigError(secretMessage),
      new IssueDetectionError(secretMessage, "HTTP_ERROR"),
      new HybridSearchError(secretMessage),
      new LegalIssueInvestigationError(secretMessage),
      new LegalAnswerError(secretMessage),
      new Error(secretMessage),
    ];

    for (const error of candidates) {
      const message = mapErrorToSafeMessage(error);
      expect(message).not.toContain("postgresql://");
      expect(message).not.toContain("sk-proj-SECRET");
      expect(message).not.toContain("relation");
      expect(message).not.toContain(secretMessage);
    }
  });
});
