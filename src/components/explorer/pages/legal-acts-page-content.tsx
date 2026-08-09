"use client";

import { useMemo, useState } from "react";
import { BellRing, ExternalLink, ListFilter, Scale, Search } from "lucide-react";

import { DemoNotice } from "@/components/explorer/demo-notice";
import { FormSelect } from "@/components/explorer/form-select";
import { Modal } from "@/components/explorer/modal";
import { Panel } from "@/components/explorer/panel";
import { SwitchToggle } from "@/components/explorer/switch-toggle";
import { TabGroup } from "@/components/explorer/tab-group";
import { SectionHeader } from "@/components/section-header";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_LEGAL_ACT_FILTERS,
  filterLegalActs,
  type LegalActFilters,
} from "@/lib/explorer/demo/legal-acts-filters";
import {
  DEMO_LEGAL_ACTS,
  getPublicationYear,
  LEGAL_ACT_CATEGORIES,
  LEGAL_ACT_STATUS_LABELS,
  type LegalActRecord,
  type LegalActStatus,
} from "@/lib/explorer/demo/legal-acts";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<LegalActStatus, string> = {
  in_force: "border-success/40 bg-success/15 text-foreground",
  amended: "border-border bg-surface-secondary text-foreground",
  repealed: "border-destructive/40 bg-destructive/15 text-foreground",
};

export function LegalActsPageContent() {
  const [filters, setFilters] = useState<LegalActFilters>(DEFAULT_LEGAL_ACT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [previewAct, setPreviewAct] = useState<LegalActRecord | null>(null);
  const [monitorAct, setMonitorAct] = useState<LegalActRecord | null>(null);
  const [monitorEnabled, setMonitorEnabled] = useState(false);

  const actTypes = useMemo(() => Array.from(new Set(DEMO_LEGAL_ACTS.map((act) => act.actType))), []);
  const publicationYears = useMemo(
    () =>
      Array.from(new Set(DEMO_LEGAL_ACTS.map((act) => getPublicationYear(act.publication)).filter((year): year is number => year !== null))).sort(
        (a, b) => b - a,
      ),
    [],
  );

  const filtered = useMemo(() => filterLegalActs(DEMO_LEGAL_ACTS, filters), [filters]);
  const frequentlyUsed = useMemo(() => filtered.filter((act) => act.frequentlyUsed), [filtered]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <SectionHeader eyebrow="Velantis Legal Explorer" title="Akty prawne" description="Przeglądaj akty prawne dostępne w bazie." action={<DemoNotice />} />

      <TabGroup
        options={[
          { value: "PL", label: "Polska" },
          { value: "EU", label: "Unia Europejska" },
        ]}
        value={filters.jurisdiction}
        onChange={(jurisdiction) => setFilters((prev) => ({ ...prev, jurisdiction }))}
      />

      <Panel className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.searchTerm}
            onChange={(event) => setFilters((prev) => ({ ...prev, searchTerm: event.target.value }))}
            placeholder="Wyszukaj akt prawny..."
            className="h-9 bg-surface-secondary pl-8"
          />
        </div>
        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ListFilter className="h-4 w-4" />
          Filtry
        </button>
      </Panel>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFilters((prev) => ({ ...prev, category: "all" }))}
          className={cn(
            "rounded-full border px-3 py-1.5 text-sm transition",
            filters.category === "all" ? "border-border bg-surface text-foreground" : "border-transparent text-muted-foreground hover:border-border hover:bg-hover-surface",
          )}
        >
          Wszystkie kategorie
        </button>
        {LEGAL_ACT_CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setFilters((prev) => ({ ...prev, category: prev.category === category ? "all" : category }))}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition",
              filters.category === category ? "border-border bg-surface text-foreground" : "border-transparent text-muted-foreground hover:border-border hover:bg-hover-surface",
            )}
          >
            {category}
          </button>
        ))}
      </div>

      {frequentlyUsed.length > 0 ? (
        <div>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Najczęściej używane</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {frequentlyUsed.map((act) => (
              <button
                key={act.id}
                type="button"
                onClick={() => setPreviewAct(act)}
                className="rounded-xl border border-border bg-surface p-4 text-left transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Scale className="h-4 w-4 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium text-foreground">{act.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{act.actType} · {act.publication}</p>
                <span className={cn("mt-3 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", STATUS_TONE[act.status])}>
                  {LEGAL_ACT_STATUS_LABELS[act.status]}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Wszystkie akty</h3>
        <Panel className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-[0.1em] text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Nazwa aktu</th>
                  <th className="px-4 py-3 font-medium">Rodzaj</th>
                  <th className="px-4 py-3 font-medium">Publikacja</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Ostatnia zmiana</th>
                  <th className="px-4 py-3 font-medium">Stan prawny na</th>
                  <th className="px-4 py-3 font-medium text-right">Akcje</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((act) => (
                  <tr key={act.id} className="border-b border-border/70 last:border-0 hover:bg-hover-surface/60">
                    <td className="max-w-[240px] truncate px-4 py-3 font-medium text-foreground">{act.title}</td>
                    <td className="px-4 py-3 text-muted-foreground">{act.actType}</td>
                    <td className="px-4 py-3 text-muted-foreground">{act.publication}</td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", STATUS_TONE[act.status])}>
                        {LEGAL_ACT_STATUS_LABELS[act.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{act.lastChange}</td>
                    <td className="px-4 py-3 text-muted-foreground">{act.legalStateDate}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setPreviewAct(act)}
                          className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground transition hover:bg-hover-surface"
                        >
                          Podgląd
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMonitorAct(act);
                            setMonitorEnabled(false);
                          }}
                          className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground transition hover:bg-hover-surface"
                        >
                          Monitoruj
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">Brak aktów pasujących do wybranych filtrów.</p>
            ) : null}
          </div>
        </Panel>
      </div>

      <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filtry" description="Zawęź listę aktów prawnych.">
        <div className="space-y-4">
          <FormSelect
            label="Jurysdykcja"
            value={filters.jurisdiction}
            onChange={(value) => setFilters((prev) => ({ ...prev, jurisdiction: value as LegalActFilters["jurisdiction"] }))}
            options={[
              { value: "PL", label: "Polska" },
              { value: "EU", label: "Unia Europejska" },
            ]}
          />
          <FormSelect
            label="Status"
            value={filters.status}
            onChange={(value) => setFilters((prev) => ({ ...prev, status: value as LegalActFilters["status"] }))}
            options={[
              { value: "all", label: "Wszystkie statusy" },
              ...Object.entries(LEGAL_ACT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
          <FormSelect
            label="Rodzaj aktu"
            value={filters.actType}
            onChange={(value) => setFilters((prev) => ({ ...prev, actType: value }))}
            options={[{ value: "all", label: "Wszystkie rodzaje" }, ...actTypes.map((type) => ({ value: type, label: type }))]}
          />
          <FormSelect
            label="Dziedzina prawa"
            value={filters.category}
            onChange={(value) => setFilters((prev) => ({ ...prev, category: value as LegalActFilters["category"] }))}
            options={[{ value: "all", label: "Wszystkie dziedziny" }, ...LEGAL_ACT_CATEGORIES.map((category) => ({ value: category, label: category }))]}
          />
          <FormSelect
            label="Rok publikacji"
            value={String(filters.publicationYear)}
            onChange={(value) => setFilters((prev) => ({ ...prev, publicationYear: value === "all" ? "all" : Number(value) }))}
            options={[{ value: "all", label: "Wszystkie lata" }, ...publicationYears.map((year) => ({ value: String(year), label: String(year) }))]}
          />
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setFilters(DEFAULT_LEGAL_ACT_FILTERS)}
              className="rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface"
            >
              Wyczyść filtry
            </button>
            <button
              type="button"
              onClick={() => setFiltersOpen(false)}
              className="rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm font-medium text-foreground transition hover:bg-hover-surface"
            >
              Zastosuj
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={previewAct !== null} onClose={() => setPreviewAct(null)} title={previewAct?.title ?? ""} widthClassName="max-w-lg">
        {previewAct ? (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", STATUS_TONE[previewAct.status])}>
                {LEGAL_ACT_STATUS_LABELS[previewAct.status]}
              </span>
              <span className="text-xs text-muted-foreground">{previewAct.publication}</span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
              <div>
                <p className="uppercase tracking-[0.14em]">Rodzaj</p>
                <p className="mt-1 text-sm text-foreground">{previewAct.actType}</p>
              </div>
              <div>
                <p className="uppercase tracking-[0.14em]">Dziedzina</p>
                <p className="mt-1 text-sm text-foreground">{previewAct.category}</p>
              </div>
              <div>
                <p className="uppercase tracking-[0.14em]">Ostatnia zmiana</p>
                <p className="mt-1 text-sm text-foreground">{previewAct.lastChange}</p>
              </div>
              <div>
                <p className="uppercase tracking-[0.14em]">Stan prawny na</p>
                <p className="mt-1 text-sm text-foreground">{previewAct.legalStateDate}</p>
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Spis treści</p>
              <ul className="mt-2 space-y-1.5">
                {previewAct.tableOfContents.map((entry) => (
                  <li key={entry.label} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground">
                    {entry.label}
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                disabled
                title="Podgląd demonstracyjny — pełny tekst aktu nie jest jeszcze podłączony z poziomu tej listy"
                className="rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm font-medium text-muted-foreground opacity-70"
              >
                Otwórz akt
              </button>
              <button
                type="button"
                disabled
                title="Podgląd demonstracyjny — link do oficjalnego źródła zostanie dodany wraz z integracją publikatora"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground opacity-70"
              >
                Oficjalne źródło
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={monitorAct !== null} onClose={() => setMonitorAct(null)} title="Monitoruj zmiany" description={monitorAct?.title}>
        <div className="space-y-4">
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            To wyłącznie podgląd interfejsu — monitorowanie zmian w przepisach nie jest jeszcze aktywną funkcją i żadne powiadomienia nie zostaną
            utworzone.
          </p>
          <SwitchToggle
            checked={monitorEnabled}
            onChange={setMonitorEnabled}
            label="Powiadamiaj o zmianach tego aktu"
            description="Funkcja demonstracyjna — bez rzeczywistych powiadomień."
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setMonitorAct(null)} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface">
              Zamknij
            </button>
            <button
              type="button"
              disabled
              title="Funkcja demonstracyjna — zapisywanie monitorowania nie jest jeszcze dostępne"
              className="rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm font-medium text-muted-foreground opacity-60"
            >
              Zapisz
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
