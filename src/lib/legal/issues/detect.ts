import { z } from "zod";

import {
  legalIssueDetectionResultSchema,
  type LegalIssueDetectionResult,
} from "./schema";

const chatCompletionEnvelopeSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

/**
 * OpenAI strict Structured Outputs JSON Schema for issue detection. This contract has no
 * request-scoped identifiers to constrain (unlike generate/verify/skeptic, which must
 * restrict SOURCE_X/conclusionIndex to values that actually exist for that request), so it
 * is a single static schema rather than a per-request builder. Zod (legalIssueDetectionResultSchema)
 * still runs afterward as defense in depth, in particular for the >=1-retrievalQuery-per-issue
 * constraint that strict Structured Outputs cannot express (no minItems). `issues` itself is
 * intentionally unconstrained on count — zero issues is a legitimate result for a non-legal prompt.
 */
const ISSUE_DETECTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          likelihood: { type: "string", enum: ["most_likely", "possible", "needs_more_information"] },
          rationale: { type: "string" },
          retrievalQueries: { type: "array", items: { type: "string" } },
        },
        required: ["label", "likelihood", "rationale", "retrievalQueries"],
      },
    },
    // Strict mode requires every property in `required`; modeled as nullable to express
    // "optional" (null = not asked), normalized away before Zod parsing.
    clarificationQuestion: { type: ["string", "null"] },
  },
  required: ["summary", "issues", "clarificationQuestion"],
} as const;

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
- Zwróć od 0 do 4 prawdopodobnych zagadnień prawnych (issues) mogących dotyczyć opisanej sytuacji.
- Jeśli opis NIE dotyczy żadnego zagadnienia prawnego (np. pytanie o pogodę, prośba o wiersz, obliczenie matematyczne, pytanie techniczne niezwiązane z prawem, polecenie niezwiązane z prawem) — zwróć PUSTĄ tablicę issues i krótko wyjaśnij to w polu summary. NIGDY nie wymyślaj sztucznego zagadnienia prawnego tylko po to, by tablica issues nie była pusta.
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
          response_format: {
            type: "json_schema",
            json_schema: { name: "issue_detection", strict: true, schema: ISSUE_DETECTION_JSON_SCHEMA },
          },
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

  const choice = envelope.data.choices[0];
  if (!choice) {
    throw new IssueDetectionError("OpenAI chat completion response has no choices", "INVALID_RESPONSE");
  }

  if (choice.message.refusal) {
    throw new IssueDetectionError("OpenAI declined to produce a structured issue-detection response", "INVALID_RESPONSE");
  }
  if (choice.finish_reason && choice.finish_reason !== "stop") {
    throw new IssueDetectionError(
      `OpenAI issue detection response did not complete normally (finish_reason: ${choice.finish_reason})`,
      "INVALID_RESPONSE",
    );
  }

  const content = choice.message.content;
  if (!content) {
    throw new IssueDetectionError("OpenAI chat completion response has no content", "INVALID_RESPONSE");
  }

  let parsedContent: unknown;
  try {
    parsedContent = JSON.parse(content);
  } catch {
    throw new IssueDetectionError("Model response was not valid JSON", "INVALID_RESPONSE");
  }

  // Strict Structured Outputs models "optional" as nullable: an unused clarificationQuestion
  // arrives as null rather than omitted. Normalize to "no clarification needed" before Zod
  // parsing, rather than rejecting an otherwise well-formed response.
  if (parsedContent && typeof parsedContent === "object" && "clarificationQuestion" in parsedContent) {
    const value = (parsedContent as { clarificationQuestion?: unknown }).clarificationQuestion;
    if (value === "" || value === null) {
      delete (parsedContent as { clarificationQuestion?: unknown }).clarificationQuestion;
    }
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
