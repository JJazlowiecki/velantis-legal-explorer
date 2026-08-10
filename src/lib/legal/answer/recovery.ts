import { z } from "zod";

import type { AnswerTargetView } from "../issues/investigate";
import type { PackedSource } from "./packing";
import { buildRawRecoveryResponseSchema, type RawRecoveryResponse } from "./recovery-schema";

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

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_RETRIES = 2;
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

export class RecoveryGenerationError extends Error {
  constructor(
    message: string,
    public readonly code: "CONFIG" | "HTTP_ERROR" | "TIMEOUT" | "INVALID_RESPONSE",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "RecoveryGenerationError";
  }
}

/**
 * Runs ONLY when the normal generate -> verify -> skeptic pipeline produced zero verified
 * conclusions despite usable retrieval evidence existing (see answer.ts's single call site).
 * This model gets NEITHER the first draft's rejected statements NOR the issue-detection
 * hypotheses — only the raw source texts and the user's question — so it cannot "repair" a
 * rejected legal theory, only rebuild from source text from scratch. It is deliberately
 * stricter than the normal generator: every conclusion requires a verbatim excerpt up front,
 * and an empty conclusions list is an explicitly acceptable, encouraged outcome rather than
 * something to avoid.
 */
const SYSTEM_PROMPT = `Jesteś systemem odzyskiwania odpowiedzi prawnej działającym WYŁĄCZNIE na podstawie dostarczonego tekstu źródłowego.

Poprzednia próba wygenerowania odpowiedzi na to pytanie NIE przeszła weryfikacji merytorycznej — wszystkie wcześniej sformułowane twierdzenia zostały odrzucone. NIE otrzymujesz treści odrzuconych twierdzeń i NIE próbuj ich "naprawiać" ani się do nich odnosić. Zbuduj odpowiedź całkowicie od nowa, wyłącznie na podstawie poniższych źródeł.

KOLEJNOŚĆ PRIORYTETÓW (ściśle, w tej kolejności):
1. TREŚĆ ŹRÓDŁA — jedyna dopuszczalna podstawa jakiegokolwiek twierdzenia.
2. PYTANIE UŻYTKOWNIKA — kontekst, do którego treść źródła musi być materialnie istotna.
3. OGÓLNA WIEDZA PRAWNICZA — NIGDY nie używaj jej jako podstawy twierdzenia. Nigdy.

ZADANIE:
Z dostarczonych źródeł (SOURCE_X) zidentyfikuj WYŁĄCZNIE te twierdzenia prawne, które są jednocześnie:
(a) wprost i jednoznacznie ustanowione TREŚCIĄ źródła — nie interpretacją, nie uogólnieniem, nie analogią,
(b) materialnie istotne dla pytania użytkownika.

Jeżeli żadne źródło nie ustanawia wprost żadnego twierdzenia istotnego dla pytania — zwróć PUSTĄ listę conclusions. To jest w pełni poprawny, oczekiwany wynik w wielu przypadkach. NIE naciągaj słabo popartych twierdzeń tylko po to, aby lista nie była pusta — puste conclusions są zawsze lepsze niż niepoparte twierdzenie.

CELE ODPOWIEDZI (answerTargets): otrzymasz listę konkretnych, requested aspektów pytania użytkownika. Szukaj w źródłach W PIERWSZEJ KOLEJNOŚCI dowodu odpowiadającego na te cele. Jeśli conclusion bezpośrednio i substantywnie odpowiada na jeden z nich, ustaw jego answerTargetIndex (1-based) na ten cel. NIE przypisuj answerTargetIndex "na siłę" — jeśli twierdzenie jedynie luźno dotyka tematu celu, ale go substantywnie nie rozstrzyga, zostaw answerTargetIndex jako null. NIGDY nie formułuj twierdzenia wyłącznie po to, by "obsłużyć" jakiś answerTarget — reguła z KROKU wyżej (tylko to, co źródło wprost ustanawia) obowiązuje bezwzględnie, niezależnie od tego, czy dana teza pasuje do jakiegoś celu. Nie zgłaszaj też ochoczo faktów pobocznych niezwiązanych z żadnym celem tylko dlatego, że są łatwe do zweryfikowania.

Dla KAŻDEGO conclusion podaj:
- statement: dokładna, wąska treść twierdzenia (nie szersza niż to, co źródło faktycznie ustanawia),
- support: jeden lub więcej wpisów {"sourceId": "SOURCE_X", "excerpt": "..."}, gdzie excerpt jest DOSŁOWNYM (verbatim) cytatem z tekstu wskazanego źródła — NIE WOLNO parafrazować, skracać treściowo ani rekonstruować z pamięci,
- answerTargetIndex: 1-based indeks do answerTargets, którego conclusion substantywnie dotyczy, albo null.

Nie generuj gotowej prozy odpowiedzi dla użytkownika — wyłącznie strukturalne twierdzenia i (opcjonalnie) niepewności.

Odpowiedz WYŁĄCZNIE poprawnym obiektem JSON w formacie:
{"conclusions": [{"statement": string, "support": [{"sourceId": "SOURCE_X", "excerpt": string}], "answerTargetIndex": number|null}], "uncertainties": string[]}`;

export interface GenerateRecoveryConclusionsInput {
  problemDescription: string;
  sources: PackedSource[];
  /** Same request-scoped answerTargets as normal generation (issues/schema.ts) — empty for a
   * non-legal problem or when detection produced none. */
  answerTargets?: AnswerTargetView[];
}

export interface GenerateRecoveryConclusionsOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

export type GenerateRecoveryConclusionsFn = (
  input: GenerateRecoveryConclusionsInput,
  options?: GenerateRecoveryConclusionsOptions,
) => Promise<RawRecoveryResponse>;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8_000);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function formatSourceForPrompt(source: PackedSource): string {
  return `${source.sourceId} [${source.citationLabel}; akt: ${source.actTitle}]\nTreść: ${source.text}`;
}

function buildUserMessage(input: GenerateRecoveryConclusionsInput): string {
  const answerTargets = input.answerTargets ?? [];
  const answerTargetsBlock =
    answerTargets.length > 0
      ? answerTargets.map((target) => `${target.index}. ${target.text}`).join("\n")
      : "(brak wyodrębnionych celów — szukaj dowodu istotnego dla pytania ogólnie)";

  const sourcesBlock = input.sources.map(formatSourceForPrompt).join("\n\n");
  return [
    `PYTANIE UŻYTKOWNIKA:\n${input.problemDescription}`,
    `CELE ODPOWIEDZI (answerTargets):\n${answerTargetsBlock}`,
    `ŹRÓDŁA:\n${sourcesBlock}`,
  ].join("\n\n");
}

/**
 * Builds a request-scoped OpenAI strict Structured Outputs JSON Schema, constraining
 * `support.sourceId` to exactly the SOURCE_X identifiers supplied to this recovery call —
 * the same mechanism as generate.ts's buildFinalAnswerJsonSchema.
 */
function buildRecoveryJsonSchema(sourceIds: string[], allowedTargetIndexes: number[]) {
  // Same nullable-enum "anyOf" pattern as generate.ts's buildFinalAnswerJsonSchema — no
  // second target model, no new strict-schema idiom. Enumerates the actual allowed indexes
  // (not 1..count) so a partial/subset recovery call (Part 5) still only ever offers the
  // model the real, un-renumbered target indexes it was scoped to.
  const answerTargetIndexSchema =
    allowedTargetIndexes.length > 0
      ? { anyOf: [{ type: "integer", enum: allowedTargetIndexes }, { type: "null" }] }
      : { type: "null" };

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      conclusions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            statement: { type: "string" },
            support: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  sourceId: { type: "string", enum: sourceIds },
                  excerpt: { type: "string" },
                },
                required: ["sourceId", "excerpt"],
              },
            },
            answerTargetIndex: answerTargetIndexSchema,
          },
          required: ["statement", "support", "answerTargetIndex"],
        },
      },
      uncertainties: { type: "array", items: { type: "string" } },
    },
    required: ["conclusions", "uncertainties"],
  };
}

/**
 * Runs the single, bounded source-first recovery generation pass. Callers (answer.ts) must
 * only invoke this when the normal pipeline produced zero verified conclusions despite
 * usable retrieval evidence — this function itself has no looping/retry-beyond-transient-
 * failure behavior, matching the "exactly one recovery call" cost bound.
 */
export async function generateRecoveryConclusions(
  input: GenerateRecoveryConclusionsInput,
  options: GenerateRecoveryConclusionsOptions = {},
): Promise<RawRecoveryResponse> {
  if (input.sources.length === 0) {
    throw new RecoveryGenerationError(
      "generateRecoveryConclusions requires at least one packed source; callers must not invoke it with zero retrieval evidence",
      "CONFIG",
    );
  }

  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new RecoveryGenerationError("OPENAI_API_KEY is not configured", "CONFIG");
  }

  const model = options.model ?? process.env.OPENAI_GROUNDING_RECOVERY_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const fetchImpl = options.fetchImpl ?? fetch;

  const sourceIds = input.sources.map((source) => source.sourceId);
  const validSourceIds = new Set(sourceIds);
  const allowedTargetIndexes = (input.answerTargets ?? []).map((target) => target.index);
  const responseSchema = buildRawRecoveryResponseSchema(validSourceIds, new Set(allowedTargetIndexes));
  const jsonSchema = buildRecoveryJsonSchema(sourceIds, allowedTargetIndexes);
  const userMessage = buildUserMessage(input);

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
            json_schema: { name: "recovery_conclusions", strict: true, schema: jsonSchema },
          },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage },
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
      throw new RecoveryGenerationError(
        isTimeout ? "OpenAI recovery request timed out" : "OpenAI recovery request failed",
        isTimeout ? "TIMEOUT" : "HTTP_ERROR",
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new RecoveryGenerationError(
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

      throw new RecoveryGenerationError(
        `OpenAI recovery request failed with status ${response.status}`,
        "HTTP_ERROR",
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new RecoveryGenerationError("OpenAI recovery response is not valid JSON", "INVALID_RESPONSE");
    }

    return parseChatCompletionContent(payload, responseSchema);
  }
}

function parseChatCompletionContent(
  payload: unknown,
  responseSchema: ReturnType<typeof buildRawRecoveryResponseSchema>,
): RawRecoveryResponse {
  const envelope = chatCompletionEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw new RecoveryGenerationError("OpenAI chat completion response has an unexpected shape", "INVALID_RESPONSE");
  }

  const choice = envelope.data.choices[0];
  if (!choice) {
    throw new RecoveryGenerationError("OpenAI chat completion response has no choices", "INVALID_RESPONSE");
  }

  if (choice.message.refusal) {
    throw new RecoveryGenerationError("OpenAI declined to produce a structured recovery response", "INVALID_RESPONSE");
  }
  if (choice.finish_reason && choice.finish_reason !== "stop") {
    throw new RecoveryGenerationError(
      `OpenAI recovery response did not complete normally (finish_reason: ${choice.finish_reason})`,
      "INVALID_RESPONSE",
    );
  }

  const content = choice.message.content;
  if (!content) {
    throw new RecoveryGenerationError("OpenAI chat completion response has no content", "INVALID_RESPONSE");
  }

  let parsedContent: unknown;
  try {
    parsedContent = JSON.parse(content);
  } catch {
    throw new RecoveryGenerationError("Model response was not valid JSON", "INVALID_RESPONSE");
  }

  const result = responseSchema.safeParse(parsedContent);
  if (!result.success) {
    throw new RecoveryGenerationError(
      `Model response did not match the expected recovery schema: ${result.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
      "INVALID_RESPONSE",
    );
  }

  return result.data;
}
