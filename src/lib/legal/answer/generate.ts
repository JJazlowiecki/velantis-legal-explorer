import { z } from "zod";

import type { LegalIssueLikelihood } from "../issues/schema";
import type { PackedSource } from "./packing";
import { buildRawFinalAnswerResponseSchema, type RawFinalAnswerResponse } from "./schema";

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
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_RETRIES = 2;
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

export class FinalAnswerGenerationError extends Error {
  constructor(
    message: string,
    public readonly code: "CONFIG" | "HTTP_ERROR" | "TIMEOUT" | "INVALID_RESPONSE",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "FinalAnswerGenerationError";
  }
}

/**
 * Hard grounding rule: the model may explain, compare, and synthesize the supplied
 * sources, but every legal proposition (`conclusions[].statement`) must be backed by
 * at least one supplied SOURCE_X — never the model's own legal knowledge. Authority/
 * currentness qualifiers must be preserved, not smoothed over: a non-authoritative
 * or currentness-unproven source can never be described as simply "binding law."
 */
const SYSTEM_PROMPT = `Jesteś asystentem prawnym generującym końcową odpowiedź WYŁĄCZNIE na podstawie dostarczonych źródeł prawnych.

Otrzymasz: opis problemu użytkownika, listę hipotez prawnych wygenerowanych wcześniej (są to tylko hipotezy, NIE potwierdzone wnioski) oraz ponumerowane źródła (SOURCE_1, SOURCE_2, ...) — rzeczywiste fragmenty przepisów wraz z metadanymi (rodzaj wersji, klasa autorytatywności, status aktualności).

ZASADA NADRZĘDNA — UGRUNTOWANIE W ŹRÓDŁACH:
- Możesz wyjaśniać, porównywać i syntetyzować WYŁĄCZNIE treść dostarczonych źródeł.
- Każde twierdzenie prawne (conclusions[].statement) MUSI być poparte co najmniej jednym dostarczonym źródłem wskazanym przez jego identyfikator SOURCE_X.
- NIGDY nie korzystaj z własnej wiedzy prawniczej jako podstawy twierdzenia — jeśli dostarczone źródła nie potwierdzają danej tezy, nie formułuj jej jako wniosku.
- NIGDY nie wymyślaj numerów artykułów, identyfikatorów źródeł ani przepisów spoza dostarczonej listy. Cytuj WYŁĄCZNIE identyfikatory SOURCE_X dokładnie tak, jak podano.
- Jeżeli dostarczone źródła są niewystarczające dla danej hipotezy lub jej części, opisz to jako alternativePath (z pustym support, jeśli brak jakiegokolwiek powiązanego źródła) lub jako uncertainty — NIE zamieniaj hipotezy w conclusion tylko dlatego, że wcześniej ją zasugerowano.
- ZANIM wskażesz źródło jako support dla danego twierdzenia, sprawdź, czy TREŚĆ tego źródła rzeczywiście dotyczy przedstawionego stanu faktycznego, a nie tylko brzmi podobnie tematycznie lub pochodzi z tego samego aktu prawnego. Źródło regulujące inną instytucję prawną (np. przepis proceduralny dotyczący postępowania administracyjnego) nie jest podstawą do twierdzenia o instytucji z innej dziedziny prawa (np. odpowiedzialności odszkodowawczej między sąsiadami), nawet jeśli w obu występuje podobne słowo (np. "odszkodowanie"). W razie wątpliwości co do trafności źródła — NIE formułuj conclusion; opisz to jako uncertainty lub alternativePath z pustym support.

AUTORYTATYWNOŚĆ I AKTUALNOŚĆ ŹRÓDEŁ:
- Źródło o klasie "non_authoritative" (np. tekst ujednolicony UJ) NIGDY nie może być opisane jako wiążące prawo — wyraźnie zaznacz to zastrzeżenie, jeśli z takiego źródła korzystasz.
- Źródło o statusie aktualności "unproven" NIGDY nie może być opisane jako obecnie obowiązujące. Jeśli budujesz odpowiedź na takim źródle, DODAJ w treści odpowiedzi (answer) krótkie, jednoznaczne zastrzeżenie, że aktualność/obowiązywanie tego przepisu nie zostały potwierdzone (np. "aktualność tego przepisu nie została potwierdzona" lub podobne, naturalnym językiem — nie jako sztampowa formułka powtarzana bez związku z treścią).
- Źródło typu "promulgated" (historyczne/pierwotne brzmienie) nie jest automatycznie aktualnym prawem — nie sugeruj, że jest, i nie pomijaj tego zastrzeżenia milczeniem.

STYL ODPOWIEDZI (pole "answer", po polsku):
- Jasny, bezpośredni język; zwięzła terminologia prawnicza tam, gdzie potrzebna.
- Podawaj dokładne oznaczenia przepisów (np. "art. 471").
- Widoczna niepewność, gdy fakty lub źródła są niepełne.
- Unikaj: nadmiernych zastrzeżeń, ogólników, udawanej pewności, sztampowych fraz prawniczych, języka typu "jako model AI".
- Nie zalecaj automatycznie konsultacji z prawnikiem — wspomnij o tym tylko, jeśli jest to rzeczowo istotne dla sytuacji.

CLARIFICATION:
- Ustaw clarificationQuestion TYLKO jeśli brakująca informacja mogłaby istotnie zmienić podstawę prawną lub treść odpowiedzi.

Odpowiedz WYŁĄCZNIE poprawnym obiektem JSON w formacie:
{"answer": string, "conclusions": [{"statement": string, "support": [{"sourceId": "SOURCE_X"}]}], "alternativePaths": [{"issueLabel": string, "explanation": string, "support": [{"sourceId": "SOURCE_X"}]}], "uncertainties": string[], "clarificationQuestion"?: string}`;

export interface GenerateFinalAnswerInput {
  problemDescription: string;
  issues: { label: string; likelihood: LegalIssueLikelihood; rationale: string }[];
  sources: PackedSource[];
}

export interface GenerateFinalAnswerOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

export type GenerateFinalAnswerFn = (
  input: GenerateFinalAnswerInput,
  options?: GenerateFinalAnswerOptions,
) => Promise<RawFinalAnswerResponse>;

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
  const hierarchy = source.hierarchy.length > 0 ? source.hierarchy.join(" / ") : "(brak dodatkowego kontekstu)";
  return [
    `${source.sourceId} [${source.citationLabel}; akt: ${source.actTitle}; wersja: ${source.versionKind}; klasa: ${source.authorityClass}; aktualność: ${source.currentnessStatus}]`,
    `Kontekst: ${hierarchy}`,
    `Treść: ${source.text}`,
  ].join("\n");
}

function buildUserMessage(input: GenerateFinalAnswerInput): string {
  const issuesBlock =
    input.issues.length > 0
      ? input.issues
          .map((issue) => `- ${issue.label} (${issue.likelihood}): ${issue.rationale}`)
          .join("\n")
      : "(brak wygenerowanych hipotez)";

  const sourcesBlock = input.sources.map(formatSourceForPrompt).join("\n\n");

  return [
    `PROBLEM UŻYTKOWNIKA:\n${input.problemDescription}`,
    `HIPOTEZY PRAWNE (niepotwierdzone):\n${issuesBlock}`,
    `ŹRÓDŁA:\n${sourcesBlock}`,
  ].join("\n\n");
}

export async function generateFinalAnswer(
  input: GenerateFinalAnswerInput,
  options: GenerateFinalAnswerOptions = {},
): Promise<RawFinalAnswerResponse> {
  if (input.sources.length === 0) {
    throw new FinalAnswerGenerationError(
      "generateFinalAnswer requires at least one packed source; callers must not invoke it with zero retrieval evidence",
      "CONFIG",
    );
  }

  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new FinalAnswerGenerationError("OPENAI_API_KEY is not configured", "CONFIG");
  }

  const model = options.model ?? process.env.OPENAI_FINAL_ANSWER_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const fetchImpl = options.fetchImpl ?? fetch;

  const validSourceIds = new Set(input.sources.map((source) => source.sourceId));
  const responseSchema = buildRawFinalAnswerResponseSchema(validSourceIds);
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
          response_format: { type: "json_object" },
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
      throw new FinalAnswerGenerationError(
        isTimeout ? "OpenAI final-answer request timed out" : "OpenAI final-answer request failed",
        isTimeout ? "TIMEOUT" : "HTTP_ERROR",
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new FinalAnswerGenerationError(
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

      throw new FinalAnswerGenerationError(
        `OpenAI final-answer request failed with status ${response.status}`,
        "HTTP_ERROR",
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new FinalAnswerGenerationError("OpenAI final-answer response is not valid JSON", "INVALID_RESPONSE");
    }

    return parseChatCompletionContent(payload, responseSchema);
  }
}

function parseChatCompletionContent(
  payload: unknown,
  responseSchema: ReturnType<typeof buildRawFinalAnswerResponseSchema>,
): RawFinalAnswerResponse {
  const envelope = chatCompletionEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw new FinalAnswerGenerationError("OpenAI chat completion response has an unexpected shape", "INVALID_RESPONSE");
  }

  const content = envelope.data.choices[0]?.message.content;
  if (!content) {
    throw new FinalAnswerGenerationError("OpenAI chat completion response has no content", "INVALID_RESPONSE");
  }

  let parsedContent: unknown;
  try {
    parsedContent = JSON.parse(content);
  } catch {
    throw new FinalAnswerGenerationError("Model response was not valid JSON", "INVALID_RESPONSE");
  }

  // Some models emit "" instead of omitting an unused optional field under plain JSON
  // mode (no strict json_schema enforcement) — normalize that to "no clarification
  // needed" rather than rejecting an otherwise well-formed, correctly grounded response.
  if (
    parsedContent &&
    typeof parsedContent === "object" &&
    "clarificationQuestion" in parsedContent &&
    (parsedContent as { clarificationQuestion?: unknown }).clarificationQuestion === ""
  ) {
    delete (parsedContent as { clarificationQuestion?: unknown }).clarificationQuestion;
  }

  const result = responseSchema.safeParse(parsedContent);
  if (!result.success) {
    throw new FinalAnswerGenerationError(
      `Model response did not match the expected final-answer schema: ${result.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
      "INVALID_RESPONSE",
    );
  }

  return result.data;
}
