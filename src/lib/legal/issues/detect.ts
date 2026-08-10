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
    // 1-based positions in this array are referenced by answerTargetIndex below. The strict
    // schema cannot express "index must be <= answerTargets.length" (no cross-field bound) —
    // legalIssueDetectionResultSchema's superRefine is the enforcement layer, same as the
    // existing >=1-retrievalQuery constraint below.
    answerTargets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          likelihood: { type: "string", enum: ["most_likely", "possible", "needs_more_information"] },
          rationale: { type: "string" },
          answerTargetIndexes: { type: "array", items: { type: "integer" } },
          retrievalQueries: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                query: { type: "string" },
                answerTargetIndex: { type: "integer" },
              },
              required: ["query", "answerTargetIndex"],
            },
          },
        },
        required: ["label", "likelihood", "rationale", "answerTargetIndexes", "retrievalQueries"],
      },
    },
    // Strict mode requires every property in `required`; modeled as nullable to express
    // "optional" (null = not asked), normalized away before Zod parsing.
    clarificationQuestion: { type: ["string", "null"] },
  },
  required: ["summary", "answerTargets", "issues", "clarificationQuestion"],
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

Pole "summary" jest ZAWSZE WYMAGANE i NIGDY nie może być puste — niezależnie od tego, czy issues jest puste czy nie, podaj zawsze 1-2 zdania streszczające, czego dotyczy opisany problem (lub, dla treści niezwiązanych z prawem, dlaczego issues jest puste).

KROK 1 — answerTargets (czego DOKŁADNIE użytkownik oczekuje w odpowiedzi):
- Zanim wygenerujesz zagadnienia prawne, wypisz od 1 do 4 zwięzłych, sformułowanych własnymi słowami użytkownika "celów odpowiedzi" (answerTargets) — konkretnych aspektów, o które użytkownik faktycznie pyta.
- Przykład dla "Jakie prawa przysługują producentowi bazy danych i przed czym chroni go ustawa?": ["jakie prawa ma producent bazy danych", "przed jakimi działaniami ustawa go chroni"].
- NIE twórz answerTargets dla tematów, o które użytkownik nie pytał (np. nie dodawaj "czy dane są chronione RODO", jeśli pytanie tego nie dotyczy).
- Jeśli issues jest puste (patrz niżej), answerTargets też pozostaw pustą tablicą.

KROK 2 — issues (hipotezy prawne):
- Zwróć od 0 do 4 prawdopodobnych zagadnień prawnych (issues) mogących dotyczyć opisanej sytuacji.
- Jeśli opis NIE dotyczy żadnego zagadnienia prawnego (np. pytanie o pogodę, prośba o wiersz, obliczenie matematyczne, pytanie techniczne niezwiązane z prawem, polecenie niezwiązane z prawem) — zwróć PUSTĄ tablicę issues i krótko wyjaśnij to w polu summary. NIGDY nie wymyślaj sztucznego zagadnienia prawnego tylko po to, by tablica issues nie była pusta.
- KAŻDE issue musi realnie służyć odpowiedzi na co najmniej jeden answerTarget (answerTargetIndexes) — nigdy nie twórz zagadnienia, które nie odpowiada na żaden z celów użytkownika.
- Zagadnienie "most_likely" musi wprost i bezpośrednio adresować to, o co użytkownik pyta.
- Zagadnienie "possible" dodawaj TYLKO gdy jest materialnie prawdopodobne ORAZ faktycznie potrzebne, by odpowiedzieć na jakiś answerTarget. NIE dodawaj sąsiedniej dziedziny prawa tylko dlatego, że bywa ona kojarzona z tym tematem (np. dla pytania o ochronę baz danych NIE dodawaj automatycznie "prawo autorskie" ani "RODO" — dodaj je tylko, jeśli treść pytania rzeczywiście na to wskazuje).
- Nie narzucaj jednej interpretacji, jeśli możliwych jest kilka — zachowaj wiele wiarygodnych ścieżek, ale każda musi być realnie uzasadniona treścią pytania, nie tylko tematycznym skojarzeniem.
- Każde zagadnienie ma jakościowy poziom prawdopodobieństwa: "most_likely", "possible" lub "needs_more_information". Nigdy nie podawaj liczbowego procentu pewności.
- Dla każdego zagadnienia podaj krótkie uzasadnienie (rationale).

KROK 3 — retrievalQueries (zapytania wyszukiwania):
- Każde zapytanie to obiekt {"query": string, "answerTargetIndex": number} — answerTargetIndex wskazuje, na który answerTarget (1-based) to zapytanie ma odpowiedzieć.
- Dla zagadnienia "most_likely": do 3 zapytań NA answerTarget, w tym co najmniej jedno próbujące trafić w rzeczywistą normę prawną (np. "wyłączne prawo producenta pobierania danych i wtórnego wykorzystania"), nie tylko nazwę aktu prawnego (unikaj samych fraz typu "ustawa o X" czy "X w Polsce" jako jedynego zapytania).
- Dla zagadnienia "possible": zwykle 1 zapytanie na obsługiwany answerTarget.
- Nie mnóż zapytań ponad potrzebę.
- Zadaj pytanie doprecyzowujące (clarificationQuestion) TYLKO jeśli brakująca informacja mogłaby zmienić właściwą podstawę prawną. W przeciwnym razie pomiń to pole.
- Odpowiedz WYŁĄCZNIE poprawnym obiektem JSON, bez żadnego dodatkowego tekstu, w formacie:
{"summary": string, "answerTargets": [{"text": string}], "issues": [{"label": string, "likelihood": "most_likely"|"possible"|"needs_more_information", "rationale": string, "answerTargetIndexes": number[], "retrievalQueries": [{"query": string, "answerTargetIndex": number}]}], "clarificationQuestion"?: string}`;

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
