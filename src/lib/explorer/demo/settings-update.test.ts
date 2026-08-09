import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "./settings";
import { updateSettingsSection } from "./settings-update";

describe("updateSettingsSection", () => {
  it("merges a partial patch into the target section only", () => {
    const next = updateSettingsSection(DEFAULT_SETTINGS, "general", { compactMode: true });

    expect(next.general.compactMode).toBe(true);
    expect(next.general.theme).toBe(DEFAULT_SETTINGS.general.theme);
    expect(next.search).toEqual(DEFAULT_SETTINGS.search);
  });

  it("does not mutate the original settings object", () => {
    const original = structuredClone(DEFAULT_SETTINGS);
    updateSettingsSection(DEFAULT_SETTINGS, "privacy", { storeSearchHistory: false });

    expect(DEFAULT_SETTINGS).toEqual(original);
  });

  it("supports updating a nested boolean toggle in a different section", () => {
    const next = updateSettingsSection(DEFAULT_SETTINGS, "notifications", { legalChangeAlerts: false });
    expect(next.notifications.legalChangeAlerts).toBe(false);
    expect(next.notifications.emailFrequency).toBe(DEFAULT_SETTINGS.notifications.emailFrequency);
  });
});
