export interface ExplorerQueryValidationOk {
  ok: true;
  query: string;
}

export interface ExplorerQueryValidationError {
  ok: false;
  error: string;
}

export type ExplorerQueryValidationResult = ExplorerQueryValidationOk | ExplorerQueryValidationError;

export const EXPLORER_QUERY_MIN_LENGTH = 3;
export const EXPLORER_QUERY_MAX_LENGTH = 2000;

/** Server-side validation for the /explorer query input. Trims, then rejects blank/too-short/too-long input. */
export function validateExplorerQuery(raw: unknown): ExplorerQueryValidationResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "Zapytanie musi być tekstem." };
  }

  const query = raw.trim();

  if (query.length === 0) {
    return { ok: false, error: "Wpisz treść pytania." };
  }

  if (query.length < EXPLORER_QUERY_MIN_LENGTH) {
    return { ok: false, error: `Pytanie jest zbyt krótkie (minimum ${EXPLORER_QUERY_MIN_LENGTH} znaki).` };
  }

  if (query.length > EXPLORER_QUERY_MAX_LENGTH) {
    return { ok: false, error: `Pytanie jest zbyt długie (maksimum ${EXPLORER_QUERY_MAX_LENGTH} znaków).` };
  }

  return { ok: true, query };
}
