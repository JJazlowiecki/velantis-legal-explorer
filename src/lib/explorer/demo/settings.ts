/**
 * Settings are LOCAL UI STATE ONLY. Nothing here is read from or written to a server —
 * `DEFAULT_SETTINGS` is the initial in-memory state for the /explorer/settings page.
 */
export type SettingsSection =
  | "general"
  | "search"
  | "ai_answers"
  | "citations"
  | "notifications"
  | "privacy"
  | "accessibility";

export const SETTINGS_SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "general", label: "Ogólne" },
  { id: "search", label: "Wyszukiwanie" },
  { id: "ai_answers", label: "Odpowiedzi AI" },
  { id: "citations", label: "Cytowania" },
  { id: "notifications", label: "Powiadomienia" },
  { id: "privacy", label: "Prywatność i dane" },
  { id: "accessibility", label: "Dostępność" },
];

export interface ExplorerSettings {
  general: {
    interfaceLanguage: "pl" | "en";
    defaultJurisdiction: "PL" | "EU" | "PL_EU";
    legalStateDateBehavior: "always_current" | "ask_each_time" | "fixed_date";
    theme: "dark" | "light" | "system";
    textSize: "small" | "medium" | "large";
    compactMode: boolean;
  };
  search: {
    defaultMode: "ai" | "classic";
    jurisdictionRange: "PL" | "PL_EU";
    onlyCurrentProvisions: boolean;
    resultCount: 10 | 20 | 50;
    autoSuggestions: boolean;
  };
  aiAnswers: {
    responseLength: "concise" | "standard" | "detailed";
    showUncertainties: boolean;
    showAlternativePaths: boolean;
    requireClarifyingQuestions: boolean;
  };
  citations: {
    format: "short" | "full" | "eli";
    preserveSourcesInExports: boolean;
  };
  notifications: {
    legalChangeAlerts: boolean;
    emailFrequency: "immediately" | "daily" | "weekly" | "never";
  };
  privacy: {
    storeSearchHistory: boolean;
    personalization: boolean;
  };
  accessibility: {
    highContrast: boolean;
    reduceMotion: boolean;
    underlineLinks: boolean;
    screenReaderOptimizedAnswers: boolean;
  };
}

export const DEFAULT_SETTINGS: ExplorerSettings = {
  general: {
    interfaceLanguage: "pl",
    defaultJurisdiction: "PL",
    legalStateDateBehavior: "ask_each_time",
    theme: "dark",
    textSize: "medium",
    compactMode: false,
  },
  search: {
    defaultMode: "ai",
    jurisdictionRange: "PL",
    onlyCurrentProvisions: true,
    resultCount: 20,
    autoSuggestions: true,
  },
  aiAnswers: {
    responseLength: "standard",
    showUncertainties: true,
    showAlternativePaths: true,
    requireClarifyingQuestions: false,
  },
  citations: {
    format: "full",
    preserveSourcesInExports: true,
  },
  notifications: {
    legalChangeAlerts: true,
    emailFrequency: "weekly",
  },
  privacy: {
    storeSearchHistory: true,
    personalization: true,
  },
  accessibility: {
    highContrast: false,
    reduceMotion: false,
    underlineLinks: false,
    screenReaderOptimizedAnswers: false,
  },
};
