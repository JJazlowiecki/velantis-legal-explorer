import { LegalAnswerError } from "@/lib/legal/answer/answer";
import { FinalAnswerGenerationError } from "@/lib/legal/answer/generate";
import { ConclusionVerificationError } from "@/lib/legal/answer/verify";
import { IssueDetectionError } from "@/lib/legal/issues/detect";
import { LegalIssueInvestigationError } from "@/lib/legal/issues/investigate";
import { EmbeddingError } from "@/lib/legal/search/embeddings";
import { HybridSearchError } from "@/lib/legal/search/service";
import { CurrentCorpusNotReadyError, ExplorerConfigError } from "./corpus-config";

const GENERIC_ERROR_MESSAGE = "Wystąpił nieoczekiwany błąd. Spróbuj ponownie później.";

/**
 * Maps any error the /explorer pipeline can throw to a fixed, safe, Polish user-facing
 * message. Never returns `error.message`, a stack trace, an API response body, or a SQL
 * error — only one of these constant strings. Callers are expected to log the raw error
 * server-side (sanitized: name + message only) for diagnostics.
 */
export function mapErrorToSafeMessage(error: unknown): string {
  if (error instanceof ExplorerConfigError) {
    return "Środowisko testowe nie jest poprawnie skonfigurowane (brak korpusu testowego). Skontaktuj się z administratorem środowiska.";
  }

  if (error instanceof CurrentCorpusNotReadyError) {
    return "Brak gotowego korpusu aktualnego prawa.";
  }

  if (
    error instanceof IssueDetectionError ||
    error instanceof FinalAnswerGenerationError ||
    error instanceof ConclusionVerificationError
  ) {
    return "Usługa analizy prawnej jest chwilowo niedostępna. Spróbuj ponownie za chwilę.";
  }

  if (error instanceof HybridSearchError || error instanceof EmbeddingError) {
    return "Wystąpił błąd podczas wyszukiwania w bazie przepisów. Spróbuj ponownie później.";
  }

  if (error instanceof LegalIssueInvestigationError) {
    return "Nie udało się przeanalizować pytania. Spróbuj sformułować je inaczej.";
  }

  if (error instanceof LegalAnswerError) {
    return GENERIC_ERROR_MESSAGE;
  }

  return GENERIC_ERROR_MESSAGE;
}
