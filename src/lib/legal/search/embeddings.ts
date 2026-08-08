import { z } from "zod";

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 3;
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

export class EmbeddingError extends Error {
  constructor(
    message: string,
    public readonly code: "CONFIG" | "HTTP_ERROR" | "TIMEOUT" | "INVALID_RESPONSE",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

const embeddingItemSchema = z.object({
  embedding: z.array(z.number()),
  index: z.number().int(),
});

const embeddingResponseSchema = z.object({
  data: z.array(embeddingItemSchema),
});

export interface EmbedTextsOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

export type EmbedTextsFn = (texts: string[], options?: EmbedTextsOptions) => Promise<number[][]>;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8_000);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function embedTexts(
  texts: string[],
  options: EmbedTextsOptions = {},
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new EmbeddingError("OPENAI_API_KEY is not configured", "CONFIG");
  }

  const model = options.model ?? process.env.OPENAI_EMBEDDING_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const fetchImpl = options.fetchImpl ?? fetch;

  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(OPENAI_EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, input: texts }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
      if (attempt < maxRetries) {
        await delay(backoffMs(attempt + 1));
        continue;
      }
      throw new EmbeddingError(
        isTimeout ? "OpenAI embeddings request timed out" : "OpenAI embeddings request failed",
        isTimeout ? "TIMEOUT" : "HTTP_ERROR",
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new EmbeddingError(
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

      throw new EmbeddingError(
        `OpenAI embeddings request failed with status ${response.status}`,
        "HTTP_ERROR",
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new EmbeddingError("OpenAI embeddings response is not valid JSON", "INVALID_RESPONSE");
    }

    const parsed = embeddingResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new EmbeddingError("OpenAI embeddings response has invalid structure", "INVALID_RESPONSE");
    }

    return [...parsed.data.data]
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }
}
