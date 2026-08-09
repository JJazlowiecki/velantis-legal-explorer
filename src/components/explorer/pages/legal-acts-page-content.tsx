"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { BellRing, ExternalLink, ListFilter, Search, ShieldAlert } from "lucide-react";

import { getLegalActFilterOptions, searchLegalActs, type LegalActSearchFilters } from "@/app/explorer/legal-acts/actions";
import { FormSelect } from "@/components/explorer/form-select";
import { Modal } from "@/components/explorer/modal";
import { Panel } from "@/components/explorer/panel";
import { SwitchToggle } from "@/components/explorer/switch-toggle";
import { TabGroup } from "@/components/explorer/tab-group";
import { SectionHeader } from "@/components/section-header";
import { Input } from "@/components/ui/input";
import {
  AUTHORITY_CLASS_LABELS,
  VERSION_KIND_LABELS,
} from "@/lib/explorer/legal-acts/labels";
import type { LegalActFilterOptions, LegalActListItem } from "@/lib/explorer/legal-acts/service";
import type { ExpressionAuthorityClass, LegalActVersionKind } from "@/lib/legal/eli/schema";
import { cn } from "@/lib/utils";

interface UiFilters {
  jurisdiction: "PL" | "EU";
  searchTerm: string;
  actType: string | "all";
  publisher: string | "all";
  journalYear: number | "all";
  authorityClass: ExpressionAuthorityClass | "all";
  versionKind: LegalActVersionKind | "all";
}

const DEFAULT_FILTERS: UiFilters = {
  jurisdiction: "PL",
  searchTerm: "",
  actType: "all",
  publisher: "all",
  journalYear: "all",
  authorityClass: "all",
  versionKind: "all",
};

function toSearchFilters(filters: UiFilters): LegalActSearchFilters {
  return {
    jurisdiction: filters.jurisdiction,
    searchTerm: filters.searchTerm.trim() || undefined,
    actType: filters.actType === "all" ? undefined : filters.actType,
    publisher: filters.publisher === "all" ? undefined : filters.publisher,
    journalYear: filters.journalYear === "all" ? undefined : filters.journalYear,
    authorityClass: filters.authorityClass === "all" ? undefined : filters.authorityClass,
    versionKind: filters.versionKind === "all" ? undefined : filters.versionKind,
  };
}

function publicationLabel(act: LegalActListItem): string {
  if (act.eliUri) return act.eliUri;
  if (act.publisher && act.journalYear && act.journalPosition) {
    return `${act.publisher} ${act.journalYear}/${act.journalPosition}`;
  }
  return "—";
}

/** Small badge summarizing the act's default-display version — never claims "Obowiązujący"/"Aktualny". */
function DefaultVersionBadge({ defaultVersion }: { defaultVersion: LegalActListItem["defaultVersion"] }) {
  if (!defaultVersion) {
    return <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">Brak wersji</span>;
  }

  const tone =
    defaultVersion.authorityClass === "non_authoritative"
      ? "border-amber-500/40 bg-amber-500/10 text-foreground"
      : "border-border bg-surface-secondary text-foreground";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", tone)}>
        {VERSION_KIND_LABELS[defaultVersion.versionKind]}
      </span>
      {!defaultVersion.hasStructure ? (
        <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
          Brak struktury
        </span>
      ) : null}
    </div>
  );
}

interface LegalActsPageContentProps {
  initialItems: LegalActListItem[];
  initialFilterOptions: LegalActFilterOptions;
}

export function LegalActsPageContent({ initialItems, initialFilterOptions }: LegalActsPageContentProps) {
  const [filters, setFilters] = useState<UiFilters>(DEFAULT_FILTERS);
  const [items, setItems] = useState<LegalActListItem[]>(initialItems);
  const [filterOptions, setFilterOptions] = useState<LegalActFilterOptions>(initialFilterOptions);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [previewAct, setPreviewAct] = useState<LegalActListItem | null>(null);
  const [monitorAct, setMonitorAct] = useState<LegalActListItem | null>(null);
  const [monitorEnabled, setMonitorEnabled] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isFirstRender = useRef(true);

  // Debounced free-text search + immediate filter changes both go through the same real,
  // server-side SQL search (src/lib/explorer/legal-acts/service.ts) — no client-side filtering
  // over a static array, and no search engine/embeddings for act-title metadata. Skips the
  // initial mount (server-rendered initialItems/initialFilterOptions are already correct for
  // the default filters) and skips entirely while jurisdiction is EU (no real EU data to
  // query yet — see the honest empty-state panel below).
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (filters.jurisdiction === "EU") {
      return;
    }

    const handle = setTimeout(
      () => {
        startTransition(async () => {
          const [nextItems, nextOptions] = await Promise.all([
            searchLegalActs(toSearchFilters(filters)),
            getLegalActFilterOptions(filters.jurisdiction),
          ]);
          setItems(nextItems);
          setFilterOptions(nextOptions);
        });
      },
      filters.searchTerm ? 300 : 0,
    );
    return () => clearTimeout(handle);
  }, [filters]);

  const isEu = filters.jurisdiction === "EU";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <SectionHeader eyebrow="Velantis Legal Explorer" title="Akty prawne" description="Przeglądaj akty prawne dostępne w bazie." />

      <TabGroup
        options={[
          { value: "PL", label: "Polska" },
          { value: "EU", label: "Unia Europejska" },
        ]}
        value={filters.jurisdiction}
        onChange={(jurisdiction) => setFilters((prev) => ({ ...prev, jurisdiction }))}
      />

      {isEu ? (
        <Panel className="text-center">
          <p className="text-sm text-foreground">Unia Europejska — wkrótce.</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Akty prawa unijnego (np. EUR-Lex) nie są jeszcze zaindeksowane w tej instancji. Ta zakładka nie zawiera danych demonstracyjnych.
          </p>
        </Panel>
      ) : (
        <>
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

          <div>
            <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Wszystkie akty {isPending ? "· odświeżanie…" : null}
            </h3>
            <Panel className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-[0.1em] text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Nazwa aktu</th>
                      <th className="px-4 py-3 font-medium">Rodzaj</th>
                      <th className="px-4 py-3 font-medium">Publikacja</th>
                      <th className="px-4 py-3 font-medium">Wersja domyślna</th>
                      <th className="px-4 py-3 font-medium">Wersje</th>
                      <th className="px-4 py-3 font-medium text-right">Akcje</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((act) => (
                      <tr key={act.id} className="border-b border-border/70 last:border-0 hover:bg-hover-surface/60">
                        <td className="max-w-[240px] truncate px-4 py-3 font-medium text-foreground">{act.title}</td>
                        <td className="px-4 py-3 text-muted-foreground">{act.actType}</td>
                        <td className="px-4 py-3 text-muted-foreground">{publicationLabel(act)}</td>
                        <td className="px-4 py-3">
                          <DefaultVersionBadge defaultVersion={act.defaultVersion} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{act.versionCount}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setPreviewAct(act)}
                              className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground transition hover:bg-hover-surface"
                            >
                              Podgląd
                            </button>
                            <Link
                              href={`/explorer/legal-acts/${act.id}`}
                              className="rounded-lg border border-border bg-surface-secondary px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-hover-surface"
                            >
                              Otwórz
                            </Link>
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
                {items.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">Brak aktów pasujących do wybranych filtrów.</p>
                ) : null}
              </div>
            </Panel>
          </div>
        </>
      )}

      <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filtry" description="Zawęź listę aktów prawnych.">
        <div className="space-y-4">
          <FormSelect
            label="Rodzaj aktu"
            value={filters.actType}
            onChange={(value) => setFilters((prev) => ({ ...prev, actType: value }))}
            options={[{ value: "all", label: "Wszystkie rodzaje" }, ...filterOptions.actTypes.map((type) => ({ value: type, label: type }))]}
          />
          <FormSelect
            label="Wydawca"
            value={filters.publisher}
            onChange={(value) => setFilters((prev) => ({ ...prev, publisher: value }))}
            options={[{ value: "all", label: "Wszyscy wydawcy" }, ...filterOptions.publishers.map((p) => ({ value: p, label: p }))]}
          />
          <FormSelect
            label="Rok publikacji"
            value={String(filters.journalYear)}
            onChange={(value) => setFilters((prev) => ({ ...prev, journalYear: value === "all" ? "all" : Number(value) }))}
            options={[{ value: "all", label: "Wszystkie lata" }, ...filterOptions.journalYears.map((year) => ({ value: String(year), label: String(year) }))]}
          />
          <FormSelect
            label="Rodzaj wersji domyślnej"
            value={filters.versionKind}
            onChange={(value) => setFilters((prev) => ({ ...prev, versionKind: value as UiFilters["versionKind"] }))}
            options={[
              { value: "all", label: "Wszystkie rodzaje wersji" },
              ...Object.entries(VERSION_KIND_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
          <FormSelect
            label="Klasa autorytatywności (wersja domyślna)"
            value={filters.authorityClass}
            onChange={(value) => setFilters((prev) => ({ ...prev, authorityClass: value as UiFilters["authorityClass"] }))}
            options={[
              { value: "all", label: "Wszystkie klasy" },
              ...Object.entries(AUTHORITY_CLASS_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setFilters((prev) => ({ ...DEFAULT_FILTERS, jurisdiction: prev.jurisdiction }))}
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
              <DefaultVersionBadge defaultVersion={previewAct.defaultVersion} />
              <span className="text-xs text-muted-foreground">{publicationLabel(previewAct)}</span>
            </div>

            {previewAct.defaultVersion?.nonAuthoritative ? (
              <p className="flex items-start gap-1.5 text-xs text-amber-300">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Wersja domyślna jest tekstem nieautorytatywnym — nie stanowi samodzielnie wiążącego prawa.
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
              <div>
                <p className="uppercase tracking-[0.14em]">Rodzaj</p>
                <p className="mt-1 text-sm text-foreground">{previewAct.actType}</p>
              </div>
              <div>
                <p className="uppercase tracking-[0.14em]">Wydawca</p>
                <p className="mt-1 text-sm text-foreground">{previewAct.publisher ?? "—"}</p>
              </div>
              <div>
                <p className="uppercase tracking-[0.14em]">Liczba wersji</p>
                <p className="mt-1 text-sm text-foreground">{previewAct.versionCount}</p>
              </div>
              <div>
                <p className="uppercase tracking-[0.14em]">Aktualność</p>
                <p className="mt-1 text-sm text-foreground">Aktualność niepotwierdzona</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <Link
                href={`/explorer/legal-acts/${previewAct.id}`}
                className="rounded-lg border border-border bg-surface-secondary px-3 py-2 text-center text-sm font-medium text-foreground transition hover:bg-hover-surface"
              >
                Otwórz akt
              </Link>
              {previewAct.officialPageUrl ? (
                <a
                  href={previewAct.officialPageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface"
                >
                  Oficjalne źródło
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  title="Brak znanego oficjalnego adresu URL dla tego aktu"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground opacity-70"
                >
                  Oficjalne źródło
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              )}
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
