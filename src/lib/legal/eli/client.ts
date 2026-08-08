import {
  ELI_API_BASE_URL,
  type EliActMetadata,
  type EliStructResponse,
  parseEliActMetadata,
  parseEliActStruct,
} from "./schema";

const DEFAULT_TIMEOUT_MS = 12_000;

export class EliClientError extends Error {
  constructor(
    message: string,
    public readonly code: "HTTP_ERROR" | "TIMEOUT" | "INVALID_RESPONSE",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "EliClientError";
  }
}

export interface FetchEliActMetadataInput {
  publisher: string;
  year: number;
  position: number;
}

export interface FetchEliActMetadataOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface FetchEliActStructOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface FetchEliActTextHtmlOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function buildActPath(input: FetchEliActMetadataInput): string {
  return `/eli/acts/${encodeURIComponent(input.publisher)}/${input.year}/${input.position}`;
}

export function buildActApiUrl(
  input: FetchEliActMetadataInput,
  baseUrl: string = ELI_API_BASE_URL,
): string {
  return `${baseUrl}${buildActPath(input)}`;
}

export function buildActStructApiUrl(
  input: FetchEliActMetadataInput,
  baseUrl: string = ELI_API_BASE_URL,
): string {
  return `${buildActApiUrl(input, baseUrl)}/struct`;
}

export function buildActTextHtmlApiUrl(
  input: FetchEliActMetadataInput,
  baseUrl: string = ELI_API_BASE_URL,
): string {
  return `${buildActApiUrl(input, baseUrl)}/text.html`;
}

export function buildActTextHtmlFragmentApiUrl(
  input: FetchEliActMetadataInput,
  tree: string,
  baseUrl: string = ELI_API_BASE_URL,
): string {
  return `${buildActTextHtmlApiUrl(input, baseUrl)}/${encodeURIComponent(tree)}`;
}

async function fetchJson(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Velantis-Legal-Explorer/0.1 (+https://velantis.local)",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new EliClientError("ELI request timed out", "TIMEOUT");
    }

    throw new EliClientError("ELI request failed", "HTTP_ERROR");
  }

  if (!response.ok) {
    throw new EliClientError(
      `ELI request failed with status ${response.status}`,
      "HTTP_ERROR",
      response.status,
    );
  }

  try {
    return await response.json();
  } catch {
    throw new EliClientError("ELI response is not valid JSON", "INVALID_RESPONSE");
  }
}

async function fetchHtml(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: "text/html",
        // The endpoint may return empty bodies for non-browser UA strings.
        "User-Agent": "Mozilla/5.0 (compatible; VelantisLegalExplorer/0.1)",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new EliClientError("ELI request timed out", "TIMEOUT");
    }

    throw new EliClientError("ELI request failed", "HTTP_ERROR");
  }

  if (!response.ok) {
    throw new EliClientError(
      `ELI request failed with status ${response.status}`,
      "HTTP_ERROR",
      response.status,
    );
  }

  return response.text();
}

export async function fetchEliActMetadata(
  input: FetchEliActMetadataInput,
  options: FetchEliActMetadataOptions = {},
): Promise<EliActMetadata> {
  const baseUrl = options.baseUrl ?? ELI_API_BASE_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = buildActApiUrl(input, baseUrl);
  const payload = await fetchJson(url, timeoutMs, fetchImpl);

  try {
    return parseEliActMetadata(payload);
  } catch {
    throw new EliClientError("ELI response has invalid structure", "INVALID_RESPONSE");
  }
}

export async function fetchEliActStruct(
  input: FetchEliActMetadataInput,
  options: FetchEliActStructOptions = {},
): Promise<EliStructResponse> {
  const baseUrl = options.baseUrl ?? ELI_API_BASE_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = buildActStructApiUrl(input, baseUrl);
  const payload = await fetchJson(url, timeoutMs, fetchImpl);

  try {
    return parseEliActStruct(payload);
  } catch {
    throw new EliClientError("ELI struct response has invalid structure", "INVALID_RESPONSE");
  }
}

export async function fetchEliActTextHtml(
  input: FetchEliActMetadataInput,
  options: FetchEliActTextHtmlOptions = {},
): Promise<string> {
  const baseUrl = options.baseUrl ?? ELI_API_BASE_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = buildActTextHtmlApiUrl(input, baseUrl);
  return fetchHtml(url, timeoutMs, fetchImpl);
}

export async function fetchEliActTextHtmlFragment(
  input: FetchEliActMetadataInput,
  tree: string,
  options: FetchEliActTextHtmlOptions = {},
): Promise<string> {
  const baseUrl = options.baseUrl ?? ELI_API_BASE_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = buildActTextHtmlFragmentApiUrl(input, tree, baseUrl);
  return fetchHtml(url, timeoutMs, fetchImpl);
}
