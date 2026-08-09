import { z } from "zod";

import {
  legalIssueDetectionResultSchema,
  type LegalIssueDetectionResult,
} from "./schema";

const chatCompletionEnvelopeSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable() }),
      }),
    )
    .min(1),
});

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

export class IssueDetectionError extends Error {
  constructor(
    message: string,
    public readonly code: "CONFIG" | "HTTP_ERROR" | "TIMEOUT" | "INVALID_RESPONSE",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "IssueDetectionError";
  }
}

/**
 * Deliberately narrow scope: this call proposes retrieval hypotheses only. It
 * must never assert verified legal conclusions, must represent uncertainty
 * qualitatively (never invent numeric confidence), and must only ask a
 * clarifying question when a missing fact could change which legal basis
 * applies — otherwise it should keep multiple plausible hypotheses open.
 */
const SYSTEM_PROMPT = `Jesteś asystentem prawnym pomagającym zidentyfikować możliwe zagadnienia prawne w opisie problemu podanym w języku potocznym (polski).

Twoim zadaniem NIE jest udzielenie porady prawnej ani ostatecznej odpowiedzi. Generujesz WYŁĄCZNIE hipotezy do dalszego wyszukiwania przepisów — nie są to ustalone wnioski prawne.

Zasady:
- Zwróć od 1 do 4 prawdopodobnych zagadnień prawnych (issues) mogących dotyczyć opisanej sytuacji.
- Nie narzucaj jednej interpretacji, jeśli możliwych jest kilka — zachowaj wiele wiarygodnych ścieżek.
- Każde zagadnienie ma jakościowy poziom prawdopodobieństwa: "most_likely", "possible" lub "needs_more_information". Nigdy nie podawaj liczbowego procentu pewności.
- Dla każdego zagadnienia podaj krótkie uzasadnienie (rationale) i od 1 do 3 zwięzłych zapytań wyszukiwania (retrievalQueries) w języku polskim, przydatnych do wyszukania odpowiednich przepisów.
- Zadaj pytanie doprecyzowujące (clarificationQuestion) TYLKO jeśli brakująca informacja mogłaby zmienić właściwą podstawę prawną. W przeciwnym razie pomiń to pole.
- Odpowiedz WYŁĄCZNIE poprawnym obiektem JSON, bez żadnego dodatkowego tekstu, w formacie:
{"summary": string, "issues": [{"label": string, "likelihood": "most_likely"|"possible"|"needs_more_information", "rationale": string, "retrievalQueries": string[]}], "clarificationQuestion"?: string}`;

export interface DetectLegalIssuesOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

export type DetectLegalIssuesFn = (
  problemDescription: string,
  options?: DetectLegalIssuesOptions,
) => Promise<LegalIssueDetectionResult>;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8_000);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function detectLegalIssues(
  problemDescription: string,
  options: DetectLegalIssuesOptions = {},
): Promise<LegalIssueDetectionResult> {
  const trimmedProblem = problemDescription.trim();
  if (!trimmedProblem) {
    throw new IssueDetectionError("problemDescription must not be empty", "CONFIG");
  }

  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new IssueDetectionError("OPENAI_API_KEY is not configured", "CONFIG");
  }

  const model = options.model ?? process.env.OPENAI_ISSUE_DETECTION_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const fetchImpl = options.fetchImpl ?? fetch;

  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(OPENAI_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: trimmedProblem },
          ],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
      if (attempt < maxRetries) {
        await delay(backoffMs(attempt + 1));
        continue;
      }
      throw new IssueDetectionError(
        isTimeout ? "OpenAI issue detection request timed out" : "OpenAI issue detection request failed",
        isTimeout ? "TIMEOUT" : "HTTP_ERROR",
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new IssueDetectionError(
        `OpenAI authentication failed with status ${response.status}`,
        "HTTP_ERROR",
        response.status,
      );
    }

    if (!response.ok) {
      if (isRetryableStatus(response.status) && attempt < maxRetries) {
        await delay(backoffMs(attempt + 1));
        continue;
      }

      throw new IssueDetectionError(
        `OpenAI issue detection request failed with status ${response.status}`,
        "HTTP_ERROR",
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new IssueDetectionError("OpenAI issue detection response is not valid JSON", "INVALID_RESPONSE");
    }

    return parseChatCompletionContent(payload);
  }
}

function parseChatCompletionContent(payload: unknown): LegalIssueDetectionResult {
  const envelope = chatCompletionEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw new IssueDetectionError("OpenAI chat completion response has an unexpected shape", "INVALID_RESPONSE");
  }

  const content = envelope.data.choices[0]?.message.content;
  if (!content) {
    throw new IssueDetectionError("OpenAI chat completion response has no content", "INVALID_RESPONSE");
  }

  let parsedContent: unknown;
  try {
    parsedContent = JSON.parse(content);
  } catch {
    throw new IssueDetectionError("Model response was not valid JSON", "INVALID_RESPONSE");
  }

  const result = legalIssueDetectionResultSchema.safeParse(parsedContent);
  if (!result.success) {
    throw new IssueDetectionError(
      `Model response did not match the expected issue-detection schema: ${result.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
      "INVALID_RESPONSE",
    );
  }

  return result.data;
}
