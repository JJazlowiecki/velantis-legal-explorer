import { z } from "zod";

import {
  buildRawConclusionVerificationResponseSchema,
  type RawConclusionVerificationResult,
} from "./verify-schema";

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

export class ConclusionVerificationError extends Error {
  constructor(
    message: string,
    public readonly code: "CONFIG" | "HTTP_ERROR" | "TIMEOUT" | "INVALID_RESPONSE",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ConclusionVerificationError";
  }
}

/**
 * A valid SOURCE_X citation is necessary but not sufficient — the verifier's only job is
 * to check whether the cited source TEXT substantively supports the exact legal statement.
 * It must not fall back to general legal knowledge to "rescue" a plausible-sounding claim,
 * and it must not receive any source the generator did not itself claim as support for that
 * specific conclusion (no unrelated retrieved evidence, no rescuing from other sources).
 *
 * This is stage 1 of 2 (see skeptic.ts for stage 2). Stage 1 requires a tri-state verdict
 * plus verbatim supporting excerpts; application code independently re-checks every excerpt
 * against the actual source text (see evidence.ts) — the model's claim of "direct_support"
 * is never trusted on its own.
 */
const SYSTEM_PROMPT = `Jesteś wyspecjalizowanym weryfikatorem prawnym. Twoim JEDYNYM zadaniem jest sprawdzenie, czy dokładnie wskazane fragmenty przepisów SUBSTANTYWNIE i BEZPOŚREDNIO potwierdzają dokładnie sformułowane twierdzenie prawne — nic więcej.

Dla każdego wniosku z listy "WNIOSKI DO WERYFIKACJI" otrzymasz: jego indeks (conclusionIndex), dokładną treść twierdzenia (statement) oraz WYŁĄCZNIE te źródła (SOURCE_X), które zostały wskazane jako podstawa TEGO KONKRETNEGO twierdzenia. Inne, niepowiązane źródła nie są Ci udostępnione — nie zakładaj ich istnienia i nie szukaj wsparcia poza tym, co dostałeś.

DWA RÓŻNE PYTANIA — odpowiadasz WYŁĄCZNIE na drugie:
1. "Czy to twierdzenie jest ogólnie prawdziwe w polskim prawie?" — TO PYTANIE JEST NIEISTOTNE. Nie oceniaj tego. Twierdzenie może być ogólnie prawdziwe w oderwaniu od sprawy, a mimo to dostarczone źródło go NIE ustanawia.
2. "Czy TA KONKRETNA dostarczona treść źródła USTANAWIA/POTWIERDZA TO KONKRETNE twierdzenie?" — to jedyne pytanie, na które odpowiadasz.

Dla każdego wniosku przypisz jeden werdykt (verdict):
- "direct_support": treść źródła wprost i bezpośrednio ustanawia dokładnie tę tezę — bez potrzeby dodatkowych założeń, uogólnień czy własnej wiedzy prawniczej.
- "partial_support": źródło potwierdza tylko CZĘŚĆ szerszej tezy (np. węższy warunek, inny podmiot, inna instytucja prawna) — reszta tezy pozostaje NIEPOPARTA. Werdykt "partial_support" NIGDY nie może być traktowany jak "direct_support" — jeśli źródło nie ustanawia całości twierdzenia, to NIE jest direct_support.
- "no_support": źródło nie ustanawia tezy w żadnym istotnym zakresie, dotyczy innej instytucji prawnej, innego stanu faktycznego lub innej dziedziny prawa niż twierdzenie — nawet jeśli używa podobnych słów albo pochodzi z tego samego aktu prawnego.

ZASADY:
- NIE korzystaj z własnej wiedzy prawniczej, aby "uratować" twierdzenie, którego dostarczone źródło faktycznie nie ustanawia treścią.
- NIE hedguj/nie podwyższaj częściowego wsparcia do "direct_support" — jeśli masz wątpliwość, czy to pełne czy częściowe wsparcie, wybierz "partial_support" albo "no_support", nigdy nie zaokrąglaj w górę.
- Jeżeli verdict = "direct_support", musisz podać w polu "evidence" JEDEN LUB WIĘCEJ krótkich DOSŁOWNYCH (verbatim) fragmentów tekstu źródła, które wprost ustanawiają tezę. Fragment musi być CIĄGŁYM (nieprzerwanym), dokładnym cytatem z dostarczonego tekstu źródła — NIE WOLNO parafrazować, skracać treściowo, łączyć nieciągłych fragmentów w jeden cytat ani rekonstruować z pamięci. Skopiuj fragment znak w znak z dostarczonego tekstu źródła. Każdy fragment evidence musi zawierać poprawny "sourceId" (SOURCE_X) spośród dostarczonych dla tego wniosku.
- Jeżeli verdict = "partial_support" lub "no_support", pole "evidence" powinno być puste.
- W polu reason krótko (1-2 zdania) uzasadnij werdykt, odnosząc się do treści źródła, nie do ogólnej wiedzy prawniczej.
- NIGDY nie wymyślaj nowych identyfikatorów źródeł, numerów artykułów ani przepisów. Cytuj WYŁĄCZNIE identyfikatory SOURCE_X dokładnie tak, jak podano dla danego wniosku.
- Zwróć DOKŁADNIE jeden wynik dla KAŻDEGO dostarczonego wniosku — odpowiedź musi zawierać pole dla każdego z nich, bez pomijania żadnego.

Odpowiedz WYŁĄCZNIE poprawnym obiektem JSON, gdzie kluczem dla wniosku o indeksie N jest "result_N" (np. "result_0" dla WNIOSKU #0), w formacie:
{"result_0": {"verdict": "direct_support"|"partial_support"|"no_support", "reason": string, "evidence": [{"sourceId": "SOURCE_X", "excerpt": string}]}, "result_1": {...}, ...}`;

export interface ConclusionSourceForVerification {
  sourceId: string;
  citationLabel: string;
  text: string;
}

export interface ConclusionToVerify {
  conclusionIndex: number;
  statement: string;
  sources: ConclusionSourceForVerification[];
}

export interface VerifyConclusionSupportInput {
  problemDescription: string;
  conclusions: ConclusionToVerify[];
}

export interface VerifyConclusionSupportOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

export type VerifyConclusionSupportFn = (
  input: VerifyConclusionSupportInput,
  options?: VerifyConclusionSupportOptions,
) => Promise<RawConclusionVerificationResult[]>;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8_000);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function formatSourceForPrompt(source: ConclusionSourceForVerification): string {
  return `${source.sourceId} [${source.citationLabel}]\nTreść: ${source.text}`;
}

function buildUserMessage(input: VerifyConclusionSupportInput): string {
  const conclusionsBlock = input.conclusions
    .map((conclusion) => {
      const sourcesBlock =
        conclusion.sources.length > 0
          ? conclusion.sources.map(formatSourceForPrompt).join("\n\n")
          : "(brak — wniosek nie wskazuje żadnego źródła)";
      return [
        `WNIOSEK #${conclusionIndexLabel(conclusion.conclusionIndex)}`,
        `TWIERDZENIE: ${conclusion.statement}`,
        `ŹRÓDŁA DOSTARCZONE DLA TEGO WNIOSKU:\n${sourcesBlock}`,
      ].join("\n");
    })
    .join("\n\n");

  return [`PROBLEM UŻYTKOWNIKA (dla kontekstu):\n${input.problemDescription}`, `WNIOSKI DO WERYFIKACJI:\n${conclusionsBlock}`].join(
    "\n\n",
  );
}

function conclusionIndexLabel(conclusionIndex: number): string {
  return String(conclusionIndex);
}

/** Deterministic key for a per-conclusion result field, e.g. `result_0`, `result_12`. */
function resultKeyFor(conclusionIndex: number): string {
  return `result_${conclusionIndex}`;
}

/**
 * Builds a request-scoped OpenAI strict Structured Outputs JSON Schema.
 *
 * Deliberately modeled as an OBJECT with one required `result_<index>` property per supplied
 * conclusion — NOT an array of `{conclusionIndex, ...}` items. JSON Schema's `array` type only
 * constrains the shape of each item, never the item COUNT, so an array-shaped schema cannot
 * stop the model from silently omitting one conclusion's result (the exact live failure this
 * hardening pass targets: "Missing verification result for conclusionIndex N"). An object
 * schema's `required` list, combined with `additionalProperties: false`, IS enforced by
 * OpenAI's constrained decoding — the model is structurally unable to produce valid JSON
 * without every required key present. `evidence.sourceId` is constrained to the union of
 * source ids supplied across all conclusions in the batch — a single static schema cannot
 * express "sourceId must belong to THIS conclusion" when different conclusions have different
 * allowed sets, so that finer, per-conclusion ownership check remains enforced afterward by
 * buildRawConclusionVerificationResponseSchema (Zod), unchanged, after this response is
 * reshaped back into the `{results: [...]}` array the rest of the pipeline expects.
 */
function buildStrictVerificationJsonSchema(allowedConclusionIndices: number[], unionSourceIds: string[]) {
  const resultSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      verdict: { type: "string", enum: ["direct_support", "partial_support", "no_support"] },
      reason: { type: "string" },
      evidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            sourceId: { type: "string", enum: unionSourceIds },
            excerpt: { type: "string" },
          },
          required: ["sourceId", "excerpt"],
        },
      },
    },
    required: ["verdict", "reason", "evidence"],
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
 * Verifies each generated legal conclusion against ONLY the source text the generator
 * itself claimed as support for it — a valid SOURCE_X citation is necessary but not
 * sufficient. Throws CONFIG immediately (no network call) if there is nothing to verify.
 */
export async function verifyConclusionSupport(
  input: VerifyConclusionSupportInput,
  options: VerifyConclusionSupportOptions = {},
): Promise<RawConclusionVerificationResult[]> {
  if (input.conclusions.length === 0) {
    throw new ConclusionVerificationError(
      "verifyConclusionSupport requires at least one conclusion to verify",
      "CONFIG",
    );
  }

  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ConclusionVerificationError("OPENAI_API_KEY is not configured", "CONFIG");
  }

  const model = options.model ?? process.env.OPENAI_GROUNDING_VERIFICATION_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const fetchImpl = options.fetchImpl ?? fetch;

  const allowedSourceIdsByConclusionIndex = new Map(
    input.conclusions.map((conclusion) => [
      conclusion.conclusionIndex,
      new Set(conclusion.sources.map((source) => source.sourceId)),
    ]),
  );
  const responseSchema = buildRawConclusionVerificationResponseSchema(allowedSourceIdsByConclusionIndex);
  const allowedConclusionIndices = input.conclusions.map((conclusion) => conclusion.conclusionIndex);
  const unionSourceIds = [...new Set(input.conclusions.flatMap((conclusion) => conclusion.sources.map((s) => s.sourceId)))];
  const jsonSchema = buildStrictVerificationJsonSchema(allowedConclusionIndices, unionSourceIds);
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
            json_schema: { name: "strict_verification", strict: true, schema: jsonSchema },
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
      throw new ConclusionVerificationError(
        isTimeout ? "OpenAI verification request timed out" : "OpenAI verification request failed",
        isTimeout ? "TIMEOUT" : "HTTP_ERROR",
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new ConclusionVerificationError(
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

      throw new ConclusionVerificationError(
        `OpenAI verification request failed with status ${response.status}`,
        "HTTP_ERROR",
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ConclusionVerificationError("OpenAI verification response is not valid JSON", "INVALID_RESPONSE");
    }

    return parseChatCompletionContent(payload, responseSchema, allowedConclusionIndices);
  }
}

/**
 * Reshapes the strict Structured Outputs keyed-object payload (`{result_0: {...}, result_3:
 * {...}}`) back into the `{results: [{conclusionIndex, ...}, ...]}` array shape the existing
 * Zod validation (buildRawConclusionVerificationResponseSchema) and the rest of the pipeline
 * expect. A key present in the payload but not among `allowedConclusionIndices` is dropped
 * silently here — it will never happen under a genuinely strict-schema-conforming response
 * (additionalProperties: false forbids it), but if it did, downstream Zod validation still
 * has the final say via its own missing/unknown-index checks on the reshaped array.
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
  responseSchema: ReturnType<typeof buildRawConclusionVerificationResponseSchema>,
  allowedConclusionIndices: number[],
): RawConclusionVerificationResult[] {
  const envelope = chatCompletionEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw new ConclusionVerificationError("OpenAI chat completion response has an unexpected shape", "INVALID_RESPONSE");
  }

  const choice = envelope.data.choices[0];
  if (!choice) {
    throw new ConclusionVerificationError("OpenAI chat completion response has no choices", "INVALID_RESPONSE");
  }

  if (choice.message.refusal) {
    throw new ConclusionVerificationError("OpenAI declined to produce a structured verification response", "INVALID_RESPONSE");
  }
  if (choice.finish_reason && choice.finish_reason !== "stop") {
    throw new ConclusionVerificationError(
      `OpenAI verification response did not complete normally (finish_reason: ${choice.finish_reason})`,
      "INVALID_RESPONSE",
    );
  }

  const content = choice.message.content;
  if (!content) {
    throw new ConclusionVerificationError("OpenAI chat completion response has no content", "INVALID_RESPONSE");
  }

  let parsedContent: unknown;
  try {
    parsedContent = JSON.parse(content);
  } catch {
    throw new ConclusionVerificationError("Model response was not valid JSON", "INVALID_RESPONSE");
  }

  const reshaped = reshapeKeyedResultsToArray(parsedContent, allowedConclusionIndices);
  const result = responseSchema.safeParse(reshaped);
  if (!result.success) {
    throw new ConclusionVerificationError(
      `Model response did not match the expected verification schema: ${result.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
      "INVALID_RESPONSE",
    );
  }

  return result.data.results;
}
