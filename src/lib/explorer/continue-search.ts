/**
 * "Kontynuuj wyszukiwanie" support: no chat/session threading, no conversation DB model —
 * just prefilling the /explorer search input via a `?q=` URL param. `/explorer` with no
 * params continues to behave exactly as before.
 */

/** Extracts the initial query prefill from Next.js's parsed searchParams (?q=...). */
export function resolveInitialQuery(searchParams: { q?: string | string[] | undefined }): string {
  const value = Array.isArray(searchParams.q) ? searchParams.q[0] : searchParams.q;
  return typeof value === "string" ? value : "";
}

/** Builds the Next.js <Link href> object that navigates to /explorer prefilled with a previous query. */
export function buildContinueSearchHref(query: string): { pathname: string; query: { q: string } } {
  return { pathname: "/explorer", query: { q: query } };
}
