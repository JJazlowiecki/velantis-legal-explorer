import { ELI_API_BASE_URL, EliActMetadata, EliActReferences, parseEliActMetadata, parseEliActReferences } from "./schema";

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

function buildActPath(input: FetchEliActMetadataInput): string {
  return `/eli/acts/${encodeURIComponent(input.publisher)}/${input.year}/${input.position}`;
}

export function buildActApiUrl(
  input: FetchEliActMetadataInput,
  baseUrl: string = ELI_API_BASE_URL,
): string {
  return `${baseUrl}${buildActPath(input)}`;
}

export async function fetchEliActMetadata(
  input: FetchEliActMetadataInput,
  options: FetchEliActMetadataOptions = {},
): Promise<EliActMetadata> {
  const baseUrl = options.baseUrl ?? ELI_API_BASE_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = buildActApiUrl(input, baseUrl);

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

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new EliClientError("ELI response is not valid JSON", "INVALID_RESPONSE");
  }

  try {
    return parseEliActMetadata(payload);
  } catch {
    throw new EliClientError("ELI response has invalid structure", "INVALID_RESPONSE");
  }
}

function buildActReferencesPath(input: FetchEliActMetadataInput): string {
  return `${buildActPath(input)}/references`;
}

export function buildActReferencesApiUrl(
  input: FetchEliActMetadataInput,
  baseUrl: string = ELI_API_BASE_URL,
): string {
  return `${baseUrl}${buildActReferencesPath(input)}`;
}

export async function fetchEliActReferences(
  input: FetchEliActMetadataInput,
  options: FetchEliActMetadataOptions = {},
): Promise<EliActReferences> {
  const baseUrl = options.baseUrl ?? ELI_API_BASE_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = buildActReferencesApiUrl(input, baseUrl);

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
      throw new EliClientError("ELI references request timed out", "TIMEOUT");
    }

    throw new EliClientError("ELI references request failed", "HTTP_ERROR");
  }

  if (!response.ok) {
    throw new EliClientError(
      `ELI references request failed with status ${response.status}`,
      "HTTP_ERROR",
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new EliClientError("ELI references response is not valid JSON", "INVALID_RESPONSE");
  }

  try {
    return parseEliActReferences(payload);
  } catch {
    throw new EliClientError("ELI references response has invalid structure", "INVALID_RESPONSE");
  }
}
