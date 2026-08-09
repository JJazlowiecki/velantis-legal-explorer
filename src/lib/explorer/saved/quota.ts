/**
 * The service boundary for Saved-item quota. `createSavedItem` (service.ts) takes the
 * resolved numeric limit as a plain argument — it has no idea where the number came from.
 * Today the only caller (src/app/explorer/saved/actions.ts) resolves it from the
 * `EXPLORER_SAVED_MAX_ITEMS` env var via `resolveDefaultSavedItemMaxItems`. A future
 * plan/subscription layer can swap in a per-visitor lookup (Explorer -> one limit, Explorer
 * Pro -> another) by changing only the caller, never Saved persistence itself.
 */
export function resolveDefaultSavedItemMaxItems(envValue: number): number {
  return envValue;
}

/**
 * Small, simple folder-count ceiling to avoid pathological unbounded folder creation. Not a
 * plan-specific quota (no per-visitor override yet) — just a constant, per the milestone's
 * explicit "do not over-engineer" instruction.
 */
export const MAX_FOLDERS_PER_VISITOR = 25;

export const FOLDER_NAME_MIN_LENGTH = 1;
export const FOLDER_NAME_MAX_LENGTH = 80;
