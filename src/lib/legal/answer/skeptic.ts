import { z } from "zod";

import { buildSkepticResponseSchema, type SkepticResult } from "./skeptic-schema";

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
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

export class SkepticalVerificationError extends Error {
  constructor(
    message: string,
    public readonly code: "CONFIG" | "HTTP_ERROR" | "TIMEOUT" | "INVALID_RESPONSE",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SkepticalVerificationError";
  }
}

/**
 * Stage 2 of 2 (see verify.ts for stage 1). This pass runs ONLY over conclusions that already
 * passed strict direct_support verification with code-validated verbatim evidence. Its job is
 * adversarial, not confirmatory: actively hunt for any legal proposition in the statement that
 * the confirmed evidence does not actually establish (scope expansion, domain mismatch, omitted
 * conditions, special-rule-as-general-rule, procedural/substantive confusion, unsupported
 * causation/remedy/liability, "generally plausible but not established by this text"). It must
 * NOT try to prove the conclusion is correct — the opposite framing from stage 1 is intentional.
 */
const SYSTEM_PROMPT = `Jesteś krytycznym, sceptycznym recenzentem prawnym. Otrzymujesz twierdzenia prawne, które JUŻ PRZESZŁY pierwszy etap weryfikacji (uznano je za bezpośrednio wsparte dosłownym fragmentem dostarczonego przepisu). Twoim zadaniem NIE JEST potwierdzenie, że twierdzenie jest poprawne — Twoim zadaniem jest AKTYWNE POSZUKIWANIE każdej luki logicznej, której potwierdzony dowód (evidence) nie ustanawia.

DWA RÓŻNE PYTANIA — odpowiadasz WYŁĄCZNIE na drugie:
1. "Czy to twierdzenie jest ogólnie prawdziwe w polskim prawie?" — TO PYTANIE JEST NIEISTOTNE. Ogólna trafność prawnicza NIE ratuje twierdzenia, którego ten konkretny dowód nie ustanawia.
2. "Czy potwierdzony dowód (evidence) z tego konkretnego źródła w pełni ustanawia DOKŁADNIE to twierdzenie, bez żadnego dodatkowego kroku rozumowania, uogólnienia czy założenia?" — to jedyne pytanie, na które odpowiadasz.

Aktywnie szukaj (nie czekaj, aż będzie oczywiste) następujących wzorców nieuprawnionego skoku myślowego:
- rozszerzenie zakresu (np. przepis o wąskiej sytuacji zastosowany do szerszej kategorii spraw),
- niedopasowanie dziedziny prawa (np. przepis proceduralny/administracyjny użyty jako podstawa roszczenia cywilnego/deliktowego, albo odwrotnie),
- pominięte przesłanki lub warunki, które przepis wprost zawiera, a twierdzenie ich nie uwzględnia,
- zastosowanie przepisu szczególnego jako reguły ogólnej,
- pomylenie uprawnienia proceduralnego z prawem materialnym (np. prawo do złożenia wniosku/skargi potraktowane jako prawo do odszkodowania),
- nieuprawnione twierdzenie o związku przyczynowym, roszczeniu odszkodowawczym lub odpowiedzialności, którego przepis nie formułuje,
- twierdzenie ogólnie prawdopodobne prawniczo, ale NIEUSTANOWIONE przez tekst tego konkretnego przepisu.

Jeżeli znajdziesz którykolwiek z powyższych wzorców (albo jakikolwiek inny nieuprawniony skok), ustaw hasUnsupportedLeap = true i krótko wyjaśnij w reason, na czym polega luka. Jeśli po dokładnej, krytycznej analizie faktycznie nie znajdujesz żadnego nieuprawnionego skoku — potwierdzony dowód w pełni i bezpośrednio ustanawia dokładnie to twierdzenie — ustaw hasUnsupportedLeap = false.

W razie wątpliwości ustaw hasUnsupportedLeap = true — Twoja rola jest z założenia sceptyczna, nie afirmująca.

Zwróć DOKŁADNIE jeden wynik dla KAŻDEGO dostarczonego wniosku — odpowiedź musi zawierać pole dla każdego z nich, bez pomijania żadnego.

Odpowiedz WYŁĄCZNIE poprawnym obiektem JSON, gdzie kluczem dla wniosku o indeksie N jest "result_N" (np. "result_0" dla WNIOSKU #0), w formacie:
{"result_0": {"hasUnsupportedLeap": boolean, "reason": string}, "result_1": {...}, ...}`;

export interface SkepticSourceContext {
  sourceId: string;
  citationLabel: string;
  text: string;
}

export interface SkepticConfirmedExcerpt {
  sourceId: string;
  excerpt: string;
}

export interface ConclusionForSkepticReview {
  conclusionIndex: number;
  statement: string;
  sources: SkepticSourceContext[];
  confirmedExcerpts: SkepticConfirmedExcerpt[];
}

export interface RunSkepticalVerificationInput {
  problemDescription: string;
  conclusions: ConclusionForSkepticReview[];
}

export interface RunSkepticalVerificationOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

export type RunSkepticalVerificationFn = (
  input: RunSkepticalVerificationInput,
  options?: RunSkepticalVerificationOptions,
) => Promise<SkepticResult[]>;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8_000);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function formatSourceForPrompt(source: SkepticSourceContext): string {
  return `${source.sourceId} [${source.citationLabel}]\nTreść: ${source.text}`;
}

function formatExcerptsForPrompt(excerpts: SkepticConfirmedExcerpt[]): string {
  if (excerpts.length === 0) {
    return "(brak)";
  }
  return excerpts.map((item) => `${item.sourceId}: "${item.excerpt}"`).join("\n");
}

function buildUserMessage(input: RunSkepticalVerificationInput): string {
  const conclusionsBlock = input.conclusions
    .map((conclusion) => {
      const sourcesBlock = conclusion.sources.map(formatSourceForPrompt).join("\n\n");
      return [
        `WNIOSEK #${conclusion.conclusionIndex}`,
        `TWIERDZENIE: ${conclusion.statement}`,
        `POTWIERDZONE DOSŁOWNE FRAGMENTY DOWODOWE (evidence z etapu 1):\n${formatExcerptsForPrompt(conclusion.confirmedExcerpts)}`,
        `PEŁNA TREŚĆ ŹRÓDEŁ DOSTARCZONYCH DLA TEGO WNIOSKU (dla kontekstu):\n${sourcesBlock}`,
      ].join("\n");
    })
    .join("\n\n");

  return [
    `PROBLEM UŻYTKOWNIKA (dla kontekstu):\n${input.problemDescription}`,
    `WNIOSKI DO KRYTYCZNEJ REWIZJI:\n${conclusionsBlock}`,
  ].join("\n\n");
}

/** Deterministic key for a per-conclusion result field, e.g. `result_0`, `result_12`. */
function resultKeyFor(conclusionIndex: number): string {
  return `result_${conclusionIndex}`;
}

/**
 * Builds a request-scoped OpenAI strict Structured Outputs JSON Schema.
 *
 * Modeled as an OBJECT with one required `result_<index>` property per conclusion under
 * review — NOT an array — for the same reason as verify.ts's strict schema: JSON Schema's
 * `array` type constrains item shape but never item COUNT, so it cannot stop the model from
 * silently dropping one conclusion's review. An object's `required` list (with
 * `additionalProperties: false`) IS enforced by OpenAI's constrained decoding. Zod validation
 * (buildSkepticResponseSchema) still runs afterward as defense in depth on the reshaped
 * `{results: [...]}` array.
 */
function buildSkepticJsonSchema(allowedConclusionIndices: number[]) {
  const resultSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      hasUnsupportedLeap: { type: "boolean" },
      reason: { type: "string" },
    },
    required: ["hasUnsupportedLeap", "reason"],
  };

  const keys = allowedConclusionIndices.map(resultKeyFor);
  const properties: Record<string, typeof resultSchema> = {};
  for (const key of keys) {
    properties[key] = resultSchema;
  }

  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: keys,
  };
}

/**
 * Runs the single batched skeptical pass over all conclusions that survived stage 1. Throws
 * CONFIG immediately (no network call) if there is nothing to review — callers should skip
 * invoking this entirely when zero conclusions passed stage 1, matching the cost constraint
 * of never issuing an empty API call.
 */
export async function runSkepticalVerification(
  input: RunSkepticalVerificationInput,
  options: RunSkepticalVerificationOptions = {},
): Promise<SkepticResult[]> {
  if (input.conclusions.length === 0) {
    throw new SkepticalVerificationError(
      "runSkepticalVerification requires at least one conclusion to review",
      "CONFIG",
    );
  }

  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new SkepticalVerificationError("OPENAI_API_KEY is not configured", "CONFIG");
  }

  const model = options.model ?? process.env.OPENAI_GROUNDING_SKEPTIC_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const fetchImpl = options.fetchImpl ?? fetch;

  const expectedConclusionIndices = new Set(input.conclusions.map((conclusion) => conclusion.conclusionIndex));
  const allowedConclusionIndices = [...expectedConclusionIndices];
  const responseSchema = buildSkepticResponseSchema(expectedConclusionIndices);
  const jsonSchema = buildSkepticJsonSchema(allowedConclusionIndices);
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
            json_schema: { name: "skeptical_review", strict: true, schema: jsonSchema },
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
      throw new SkepticalVerificationError(
        isTimeout ? "OpenAI skeptical verification request timed out" : "OpenAI skeptical verification request failed",
        isTimeout ? "TIMEOUT" : "HTTP_ERROR",
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new SkepticalVerificationError(
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

      throw new SkepticalVerificationError(
        `OpenAI skeptical verification request failed with status ${response.status}`,
        "HTTP_ERROR",
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new SkepticalVerificationError("OpenAI skeptical verification response is not valid JSON", "INVALID_RESPONSE");
    }

    return parseChatCompletionContent(payload, responseSchema, allowedConclusionIndices);
  }
}

/**
 * Reshapes the strict Structured Outputs keyed-object payload (`{result_0: {...}, result_3:
 * {...}}`) back into the `{results: [{conclusionIndex, ...}, ...]}` array shape the existing
 * Zod validation (buildSkepticResponseSchema) and callers expect.
 */
function reshapeKeyedResultsToArray(parsedContent: unknown, allowedConclusionIndices: number[]): unknown {
  if (!parsedContent || typeof parsedContent !== "object") {
    return parsedContent;
  }

  const source = parsedContent as Record<string, unknown>;
  const results = allowedConclusionIndices
    .filter((conclusionIndex) => resultKeyFor(conclusionIndex) in source)
    .map((conclusionIndex) => {
      const entry = source[resultKeyFor(conclusionIndex)];
      return entry && typeof entry === "object" ? { conclusionIndex, ...entry } : entry;
    });

  return { results };
}

function parseChatCompletionContent(
  payload: unknown,
  responseSchema: ReturnType<typeof buildSkepticResponseSchema>,
  allowedConclusionIndices: number[],
): SkepticResult[] {
  const envelope = chatCompletionEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw new SkepticalVerificationError("OpenAI chat completion response has an unexpected shape", "INVALID_RESPONSE");
  }

  const choice = envelope.data.choices[0];
  if (!choice) {
    throw new SkepticalVerificationError("OpenAI chat completion response has no choices", "INVALID_RESPONSE");
  }

  if (choice.message.refusal) {
    throw new SkepticalVerificationError("OpenAI declined to produce a structured skeptical review", "INVALID_RESPONSE");
  }
  if (choice.finish_reason && choice.finish_reason !== "stop") {
    throw new SkepticalVerificationError(
      `OpenAI skeptical review response did not complete normally (finish_reason: ${choice.finish_reason})`,
      "INVALID_RESPONSE",
    );
  }

  const content = choice.message.content;
  if (!content) {
    throw new SkepticalVerificationError("OpenAI chat completion response has no content", "INVALID_RESPONSE");
  }

  let parsedContent: unknown;
  try {
    parsedContent = JSON.parse(content);
  } catch {
    throw new SkepticalVerificationError("Model response was not valid JSON", "INVALID_RESPONSE");
  }

  const reshaped = reshapeKeyedResultsToArray(parsedContent, allowedConclusionIndices);
  const result = responseSchema.safeParse(reshaped);
  if (!result.success) {
    throw new SkepticalVerificationError(
      `Model response did not match the expected skeptical review schema: ${result.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
      "INVALID_RESPONSE",
    );
  }

  return result.data.results;
}
