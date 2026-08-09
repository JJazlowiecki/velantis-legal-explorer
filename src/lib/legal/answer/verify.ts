import { z } from "zod";

import {
  buildRawConclusionVerificationResponseSchema,
  type RawConclusionVerificationResult,
} from "./verify-schema";

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
 */
const SYSTEM_PROMPT = `Jesteś wyspecjalizowanym weryfikatorem. Twoim JEDYNYM zadaniem jest sprawdzenie, czy dokładnie wskazane fragmenty przepisów SUBSTANTYWNIE potwierdzają dokładnie sformułowane twierdzenie prawne — nic więcej.

Dla każdego wniosku z listy "WNIOSKI DO WERYFIKACJI" otrzymasz: jego indeks (conclusionIndex), dokładną treść twierdzenia (statement) oraz WYŁĄCZNIE te źródła (SOURCE_X), które zostały wskazane jako podstawa TEGO KONKRETNEGO twierdzenia. Inne, niepowiązane źródła nie są Ci udostępnione — nie zakładaj ich istnienia i nie szukaj wsparcia poza tym, co dostałeś.

PYTANIE, na które odpowiadasz dla każdego wniosku (i wyłącznie na nie):
"Czy dostarczona treść źródła (źródeł) SUBSTANTYWNIE potwierdza dokładnie to twierdzenie prawne?"

ZASADY:
- NIE oceniaj, czy twierdzenie jest ogólnie prawdziwe w polskim prawie. Twierdzenie może być ogólnie prawdziwe w oderwaniu od sprawy, a mimo to NIEPOPARTE dostarczonym źródłem — wtedy supported = false.
- NIE korzystaj z własnej wiedzy prawniczej, aby "uratować" twierdzenie, którego dostarczone źródło faktycznie nie potwierdza treścią.
- Źródło regulujące inną instytucję prawną, inny stan faktyczny lub inną dziedzinę prawa niż ta, której dotyczy twierdzenie, NIE stanowi wsparcia — nawet jeśli używa podobnych słów albo pochodzi z tego samego aktu prawnego.
- supported = true tylko wtedy, gdy treść źródła rzeczywiście i wprost (albo przez jednoznaczną, bezpośrednią interpretację) odnosi się do konkretnej tezy z statement.
- Jeżeli supported = true, supportingSourceIds MUSI zawierać co najmniej jeden identyfikator spośród dostarczonych dla tego wniosku. Jeżeli supported = false, supportingSourceIds powinno być puste.
- W polu reason krótko (1-2 zdania) uzasadnij werdykt, odnosząc się do treści źródła, nie do ogólnej wiedzy prawniczej.
- NIGDY nie wymyślaj nowych identyfikatorów źródeł, numerów artykułów ani przepisów. Cytuj WYŁĄCZNIE identyfikatory SOURCE_X dokładnie tak, jak podano dla danego wniosku.
- Zwróć dokładnie jeden wynik dla każdego dostarczonego conclusionIndex.

Odpowiedz WYŁĄCZNIE poprawnym obiektem JSON w formacie:
{"results": [{"conclusionIndex": number, "supported": boolean, "reason": string, "supportingSourceIds": ["SOURCE_X", ...]}]}`;

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

    return parseChatCompletionContent(payload, responseSchema);
  }
}

function parseChatCompletionContent(
  payload: unknown,
  responseSchema: ReturnType<typeof buildRawConclusionVerificationResponseSchema>,
): RawConclusionVerificationResult[] {
  const envelope = chatCompletionEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw new ConclusionVerificationError("OpenAI chat completion response has an unexpected shape", "INVALID_RESPONSE");
  }

  const content = envelope.data.choices[0]?.message.content;
  if (!content) {
    throw new ConclusionVerificationError("OpenAI chat completion response has no content", "INVALID_RESPONSE");
  }

  let parsedContent: unknown;
  try {
    parsedContent = JSON.parse(content);
  } catch {
    throw new ConclusionVerificationError("Model response was not valid JSON", "INVALID_RESPONSE");
  }

  const result = responseSchema.safeParse(parsedContent);
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
