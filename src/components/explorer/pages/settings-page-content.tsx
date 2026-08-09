"use client";

import { useState } from "react";
import { Check } from "lucide-react";

import { DemoNotice } from "@/components/explorer/demo-notice";
import { FormSelect } from "@/components/explorer/form-select";
import { Panel } from "@/components/explorer/panel";
import { SwitchToggle } from "@/components/explorer/switch-toggle";
import { SectionHeader } from "@/components/section-header";
import { DEFAULT_SETTINGS, SETTINGS_SECTIONS, type ExplorerSettings, type SettingsSection } from "@/lib/explorer/demo/settings";
import { updateSettingsSection } from "@/lib/explorer/demo/settings-update";
import { cn } from "@/lib/utils";

export function SettingsPageContent() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [settings, setSettings] = useState<ExplorerSettings>(DEFAULT_SETTINGS);
  const [savedNotice, setSavedNotice] = useState(false);

  function patch<Section extends keyof ExplorerSettings>(section: Section, value: Partial<ExplorerSettings[Section]>) {
    setSettings((prev) => updateSettingsSection(prev, section, value));
    setSavedNotice(false);
  }

  function handleSave() {
    // Local UI state only — nothing here is sent to a server or persisted beyond this session.
    setSavedNotice(true);
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <SectionHeader
        eyebrow="Velantis Legal Explorer"
        title="Ustawienia"
        description="Dostosuj działanie Velantis Legal Explorer do swoich potrzeb."
        action={<DemoNotice />}
      />

      <div className="grid gap-6 md:grid-cols-[200px_1fr]">
        <nav aria-label="Sekcje ustawień" className="flex gap-1.5 overflow-x-auto md:flex-col md:overflow-visible">
          {SETTINGS_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSection(section.id)}
              className={cn(
                "shrink-0 rounded-lg border px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                activeSection === section.id
                  ? "border-border bg-surface text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:bg-hover-surface hover:text-foreground",
              )}
            >
              {section.label}
            </button>
          ))}
        </nav>

        <div className="flex flex-col gap-4">
          {activeSection === "general" ? <GeneralSection settings={settings} onChange={(value) => patch("general", value)} /> : null}
          {activeSection === "search" ? <SearchSection settings={settings} onChange={(value) => patch("search", value)} /> : null}
          {activeSection === "ai_answers" ? <AiAnswersSection settings={settings} onChange={(value) => patch("aiAnswers", value)} /> : null}
          {activeSection === "citations" ? <CitationsSection settings={settings} onChange={(value) => patch("citations", value)} /> : null}
          {activeSection === "notifications" ? (
            <NotificationsSection settings={settings} onChange={(value) => patch("notifications", value)} />
          ) : null}
          {activeSection === "privacy" ? <PrivacySection settings={settings} onChange={(value) => patch("privacy", value)} /> : null}
          {activeSection === "accessibility" ? (
            <AccessibilitySection settings={settings} onChange={(value) => patch("accessibility", value)} />
          ) : null}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-secondary px-4 py-2 text-sm font-medium text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Zapisz zmiany
            </button>
            {savedNotice ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check className="h-3.5 w-3.5" />
                Ustawienia zaktualizowane lokalnie w tej sesji przeglądarki (bez zapisu na serwerze).
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

interface SectionProps<Section extends keyof ExplorerSettings> {
  settings: ExplorerSettings;
  onChange: (value: Partial<ExplorerSettings[Section]>) => void;
}

function GeneralSection({ settings, onChange }: SectionProps<"general">) {
  const general = settings.general;
  return (
    <Panel title="Ogólne">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormSelect
          label="Język interfejsu"
          value={general.interfaceLanguage}
          onChange={(value) => onChange({ interfaceLanguage: value as typeof general.interfaceLanguage })}
          options={[
            { value: "pl", label: "Polski" },
            { value: "en", label: "English" },
          ]}
        />
        <FormSelect
          label="Domyślna jurysdykcja"
          value={general.defaultJurisdiction}
          onChange={(value) => onChange({ defaultJurisdiction: value as typeof general.defaultJurisdiction })}
          options={[
            { value: "PL", label: "Polska" },
            { value: "EU", label: "Unia Europejska" },
            { value: "PL_EU", label: "Polska i UE" },
          ]}
        />
        <FormSelect
          label="Data stanu prawnego"
          value={general.legalStateDateBehavior}
          onChange={(value) => onChange({ legalStateDateBehavior: value as typeof general.legalStateDateBehavior })}
          options={[
            { value: "always_current", label: "Zawsze najnowszy stan" },
            { value: "ask_each_time", label: "Pytaj przy każdym wyszukiwaniu" },
            { value: "fixed_date", label: "Stała data" },
          ]}
        />
        <FormSelect
          label="Motyw"
          value={general.theme}
          onChange={(value) => onChange({ theme: value as typeof general.theme })}
          options={[
            { value: "dark", label: "Ciemny" },
            { value: "light", label: "Jasny" },
            { value: "system", label: "Systemowy" },
          ]}
        />
        <FormSelect
          label="Rozmiar tekstu"
          value={general.textSize}
          onChange={(value) => onChange({ textSize: value as typeof general.textSize })}
          options={[
            { value: "small", label: "Mały" },
            { value: "medium", label: "Średni" },
            { value: "large", label: "Duży" },
          ]}
        />
      </div>

      <div className="mt-2">
        <SwitchToggle checked={general.compactMode} onChange={(checked) => onChange({ compactMode: checked })} label="Tryb kompaktowy" description="Zmniejsza odstępy w interfejsie." />
      </div>

      <div className="mt-4 rounded-xl border border-border/80 bg-surface-secondary/50 p-4">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Podgląd wyglądu</p>
        <div
          className={cn(
            "mt-3 rounded-lg border border-border bg-surface",
            general.compactMode ? "p-2" : "p-4",
            general.textSize === "small" ? "text-xs" : general.textSize === "large" ? "text-base" : "text-sm",
          )}
        >
          <p className="font-medium text-foreground">Przykładowy nagłówek odpowiedzi</p>
          <p className="mt-1 text-muted-foreground">Tak będzie wyglądał tekst odpowiedzi przy obecnych ustawieniach wyglądu.</p>
        </div>
      </div>
    </Panel>
  );
}

function SearchSection({ settings, onChange }: SectionProps<"search">) {
  const search = settings.search;
  return (
    <Panel title="Wyszukiwanie">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormSelect
          label="Domyślny tryb wyszukiwania"
          value={search.defaultMode}
          onChange={(value) => onChange({ defaultMode: value as typeof search.defaultMode })}
          options={[
            { value: "ai", label: "AI" },
            { value: "classic", label: "Klasyczny" },
          ]}
        />
        <FormSelect
          label="Zakres jurysdykcji"
          value={search.jurisdictionRange}
          onChange={(value) => onChange({ jurisdictionRange: value as typeof search.jurisdictionRange })}
          options={[
            { value: "PL", label: "Polska" },
            { value: "PL_EU", label: "Polska i UE" },
          ]}
        />
        <FormSelect
          label="Liczba wyników"
          value={String(search.resultCount)}
          onChange={(value) => onChange({ resultCount: Number(value) as typeof search.resultCount })}
          options={[
            { value: "10", label: "10" },
            { value: "20", label: "20" },
            { value: "50", label: "50" },
          ]}
        />
      </div>
      <div className="mt-2">
        <SwitchToggle
          checked={search.onlyCurrentProvisions}
          onChange={(checked) => onChange({ onlyCurrentProvisions: checked })}
          label="Tylko obowiązujące przepisy"
          description="Ukrywa przepisy historyczne w wynikach wyszukiwania."
        />
        <SwitchToggle
          checked={search.autoSuggestions}
          onChange={(checked) => onChange({ autoSuggestions: checked })}
          label="Podpowiedzi w trakcie wpisywania"
        />
      </div>
    </Panel>
  );
}

function AiAnswersSection({ settings, onChange }: SectionProps<"aiAnswers">) {
  const ai = settings.aiAnswers;
  return (
    <Panel title="Odpowiedzi AI">
      <FormSelect
        label="Długość odpowiedzi"
        value={ai.responseLength}
        onChange={(value) => onChange({ responseLength: value as typeof ai.responseLength })}
        options={[
          { value: "concise", label: "Zwięzła" },
          { value: "standard", label: "Standardowa" },
          { value: "detailed", label: "Szczegółowa" },
        ]}
      />
      <div className="mt-2">
        <SwitchToggle checked={ai.showUncertainties} onChange={(checked) => onChange({ showUncertainties: checked })} label="Pokazuj sekcję niepewności" />
        <SwitchToggle checked={ai.showAlternativePaths} onChange={(checked) => onChange({ showAlternativePaths: checked })} label="Pokazuj niepotwierdzone możliwe kierunki" />
        <SwitchToggle
          checked={ai.requireClarifyingQuestions}
          onChange={(checked) => onChange({ requireClarifyingQuestions: checked })}
          label="Zawsze pytaj o doprecyzowanie, gdy to możliwe"
        />
      </div>
    </Panel>
  );
}

function CitationsSection({ settings, onChange }: SectionProps<"citations">) {
  const citations = settings.citations;
  return (
    <Panel title="Cytowania">
      <FormSelect
        label="Format cytowania"
        value={citations.format}
        onChange={(value) => onChange({ format: value as typeof citations.format })}
        options={[
          { value: "short", label: "Skrócony (art. 471 k.c.)" },
          { value: "full", label: "Pełny (Ustawa z dnia... art. 471)" },
          { value: "eli", label: "Identyfikator ELI" },
        ]}
      />
      <div className="mt-2">
        <SwitchToggle
          checked={citations.preserveSourcesInExports}
          onChange={(checked) => onChange({ preserveSourcesInExports: checked })}
          label="Zachowuj pełne źródła w eksportach"
        />
      </div>
    </Panel>
  );
}

function NotificationsSection({ settings, onChange }: SectionProps<"notifications">) {
  const notifications = settings.notifications;
  return (
    <Panel title="Powiadomienia">
      <SwitchToggle
        checked={notifications.legalChangeAlerts}
        onChange={(checked) => onChange({ legalChangeAlerts: checked })}
        label="Alerty zmian w prawie"
        description="Funkcja demonstracyjna — żadne rzeczywiste powiadomienia nie są jeszcze wysyłane."
      />
      <div className="mt-3">
        <FormSelect
          label="Częstotliwość e-maili"
          value={notifications.emailFrequency}
          onChange={(value) => onChange({ emailFrequency: value as typeof notifications.emailFrequency })}
          options={[
            { value: "immediately", label: "Natychmiast" },
            { value: "daily", label: "Codziennie" },
            { value: "weekly", label: "Co tydzień" },
            { value: "never", label: "Nigdy" },
          ]}
        />
      </div>
    </Panel>
  );
}

function PrivacySection({ settings, onChange }: SectionProps<"privacy">) {
  const privacy = settings.privacy;
  const [exportRequested, setExportRequested] = useState(false);
  const [deleteHistoryRequested, setDeleteHistoryRequested] = useState(false);

  return (
    <Panel title="Prywatność i dane">
      <SwitchToggle checked={privacy.storeSearchHistory} onChange={(checked) => onChange({ storeSearchHistory: checked })} label="Zapisuj historię wyszukiwań" />
      <SwitchToggle checked={privacy.personalization} onChange={(checked) => onChange({ personalization: checked })} label="Personalizacja wyników" />

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setExportRequested(true)}
          className="rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Eksportuj moje dane
        </button>
        <button
          type="button"
          onClick={() => setDeleteHistoryRequested(true)}
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground transition hover:bg-destructive/20"
        >
          Usuń historię wyszukiwań
        </button>
      </div>

      {exportRequested ? (
        <p className="mt-3 text-xs text-muted-foreground">
          To jest podgląd interfejsu — eksport danych nie jest jeszcze podłączony do rzeczywistego magazynu danych.
        </p>
      ) : null}
      {deleteHistoryRequested ? (
        <p className="mt-3 text-xs text-muted-foreground">
          To jest podgląd interfejsu — żadna historia nie została usunięta (usuwanie z poziomu Ustawień nie jest jeszcze aktywne; zobacz stronę
          Historia, aby wypróbować lokalny podgląd czyszczenia).
        </p>
      ) : null}
    </Panel>
  );
}

function AccessibilitySection({ settings, onChange }: SectionProps<"accessibility">) {
  const accessibility = settings.accessibility;
  return (
    <Panel title="Dostępność">
      <SwitchToggle checked={accessibility.highContrast} onChange={(checked) => onChange({ highContrast: checked })} label="Wysoki kontrast" />
      <SwitchToggle checked={accessibility.reduceMotion} onChange={(checked) => onChange({ reduceMotion: checked })} label="Ogranicz animacje" />
      <SwitchToggle checked={accessibility.underlineLinks} onChange={(checked) => onChange({ underlineLinks: checked })} label="Podkreślaj odnośniki" />
      <SwitchToggle
        checked={accessibility.screenReaderOptimizedAnswers}
        onChange={(checked) => onChange({ screenReaderOptimizedAnswers: checked })}
        label="Odpowiedzi zoptymalizowane pod czytniki ekranu"
      />
    </Panel>
  );
}
