export class ExplorerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExplorerConfigError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parses the server-only EXPLORER_TEST_LEGAL_ACT_VERSION_IDS env var: a comma-separated
 * list of legalActVersion UUIDs for the local /explorer technical test corpus (DU/1960/168,
 * historical/promulgated, currentness unproven). There is no global/default corpus fallback
 * anywhere in this pipeline — missing, empty, or malformed configuration is a hard error.
 */
export function parseExplorerTestCorpusVersionIds(raw: string | undefined): string[] {
  if (!raw || raw.trim().length === 0) {
    throw new ExplorerConfigError("EXPLORER_TEST_LEGAL_ACT_VERSION_IDS is not configured");
  }

  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  if (ids.length === 0) {
    throw new ExplorerConfigError("EXPLORER_TEST_LEGAL_ACT_VERSION_IDS is empty");
  }

  for (const id of ids) {
    if (!UUID_PATTERN.test(id)) {
      throw new ExplorerConfigError(`EXPLORER_TEST_LEGAL_ACT_VERSION_IDS contains an invalid UUID: "${id}"`);
    }
  }

  return ids;
}
