import type { ExplorerSettings } from "./settings";

/** Pure, local-only settings update — merges a partial patch into one section. Never persisted. */
export function updateSettingsSection<Section extends keyof ExplorerSettings>(
  settings: ExplorerSettings,
  section: Section,
  patch: Partial<ExplorerSettings[Section]>,
): ExplorerSettings {
  return {
    ...settings,
    [section]: {
      ...settings[section],
      ...patch,
    },
  };
}
