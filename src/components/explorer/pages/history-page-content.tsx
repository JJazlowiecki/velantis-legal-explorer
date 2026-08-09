"use client";

import { useMemo, useState } from "react";
import { Bookmark, Calendar, Eye, FileText, MessageSquare, Search, Trash2 } from "lucide-react";

import { DemoNotice } from "@/components/explorer/demo-notice";
import { FormSelect } from "@/components/explorer/form-select";
import { Modal } from "@/components/explorer/modal";
import { Panel } from "@/components/explorer/panel";
import { SwitchToggle } from "@/components/explorer/switch-toggle";
import { SectionHeader } from "@/components/section-header";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_HISTORY_CLEAR_SELECTION,
  DEFAULT_HISTORY_FILTERS,
  filterHistoryEntries,
  type HistoryClearScope,
  type HistoryFilters,
} from "@/lib/explorer/demo/history-filters";
import { DEMO_HISTORY_ENTRIES, HISTORY_GROUP_LABELS, HISTORY_GROUP_ORDER, type HistoryEntry } from "@/lib/explorer/demo/history";
import { cn } from "@/lib/utils";

const CLEAR_SCOPE_OPTIONS: { value: HistoryClearScope; label: string }[] = [
  { value: "all", label: "Cała historia" },
  { value: "last_7_days", label: "Ostatnie 7 dni" },
  { value: "last_30_days", label: "Ostatnie 30 dni" },
  { value: "custom", label: "Zakres niestandardowy" },
];

export function HistoryPageContent() {
  const [entries, setEntries] = useState<HistoryEntry[]>(DEMO_HISTORY_ENTRIES);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<HistoryFilters>(DEFAULT_HISTORY_FILTERS);

  const [detailsEntry, setDetailsEntry] = useState<HistoryEntry | null>(null);
  const [continueEntry, setContinueEntry] = useState<HistoryEntry | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<HistoryEntry | null>(null);
  const [followUp, setFollowUp] = useState("");

  const [clearOpen, setClearOpen] = useState(false);
  const [clearSelection, setClearSelection] = useState(DEFAULT_HISTORY_CLEAR_SELECTION);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [clearConfirmation, setClearConfirmation] = useState<string | null>(null);

  const filtered = useMemo(() => filterHistoryEntries(entries, filters), [entries, filters]);

  const grouped = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>();
    for (const group of HISTORY_GROUP_ORDER) {
      map.set(group, []);
    }
    for (const entry of filtered) {
      map.get(entry.group)?.push(entry);
    }
    return map;
  }, [filtered]);

  function toggleSaved(id: string) {
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function confirmDelete() {
    if (!deleteEntry) return;
    setEntries((prev) => prev.filter((entry) => entry.id !== deleteEntry.id));
    setDeleteEntry(null);
  }

  function confirmClear() {
    if (clearSelection.preserveSaved) {
      setEntries((prev) => prev.filter((entry) => savedIds.has(entry.id)));
    } else {
      setEntries([]);
    }
    setClearOpen(false);
    setClearConfirmation("Historia wyszukiwań została wyczyszczona w tym podglądzie interfejsu.");
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <SectionHeader
        eyebrow="Velantis Legal Explorer"
        title="Historia"
        description="Przegląd Twoich ostatnich wyszukiwań i odpowiedzi."
        action={<DemoNotice />}
      />

      <Panel className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1 md:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filters.searchTerm}
              onChange={(event) => setFilters((prev) => ({ ...prev, searchTerm: event.target.value }))}
              placeholder="Szukaj w historii..."
              className="h-9 bg-surface-secondary pl-8"
            />
          </div>

          <FormSelect
            label=""
            className="md:w-44"
            value={filters.group}
            onChange={(value) => setFilters((prev) => ({ ...prev, group: value as HistoryFilters["group"] }))}
            options={[
              { value: "all", label: "Wszystkie daty" },
              ...HISTORY_GROUP_ORDER.map((group) => ({ value: group, label: HISTORY_GROUP_LABELS[group] })),
            ]}
          />

          <FormSelect
            label=""
            className="md:w-40"
            value={filters.type}
            onChange={(value) => setFilters((prev) => ({ ...prev, type: value as HistoryFilters["type"] }))}
            options={[
              { value: "all", label: "Wszystkie typy" },
              { value: "answer", label: "Odpowiedź" },
              { value: "provision", label: "Przepis" },
            ]}
          />
        </div>

        <button
          type="button"
          onClick={() => setClearOpen(true)}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:self-auto"
        >
          <Trash2 className="h-4 w-4" />
          Wyczyść historię
        </button>
      </Panel>

      {clearConfirmation ? (
        <p className="rounded-xl border border-border/80 bg-surface-secondary/60 px-4 py-2.5 text-sm text-muted-foreground">
          {clearConfirmation}
        </p>
      ) : null}

      <div className="flex flex-col gap-8">
        {HISTORY_GROUP_ORDER.map((group) => {
          const groupEntries = grouped.get(group) ?? [];
          if (groupEntries.length === 0) return null;

          return (
            <div key={group}>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {HISTORY_GROUP_LABELS[group]}
              </h3>
              <div className="flex flex-col gap-2">
                {groupEntries.map((entry) => (
                  <article
                    key={entry.id}
                    className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                            entry.type === "answer"
                              ? "border-border bg-surface-secondary text-foreground"
                              : "border-border/80 text-muted-foreground",
                          )}
                        >
                          {entry.type === "answer" ? <MessageSquare className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                          {entry.type === "answer" ? "Odpowiedź" : "Przepis"}
                        </span>
                        <span className="text-xs text-muted-foreground">{entry.timeLabel}</span>
                      </div>
                      <p className="mt-1.5 truncate text-sm font-medium text-foreground">{entry.title}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{entry.sourceCount} źródeł</span>
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Stan prawny na {entry.legalStateDate}
                        </span>
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setDetailsEntry(entry)}
                        aria-label="Szczegóły wyszukiwania"
                        title="Szczegóły wyszukiwania"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-hover-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setContinueEntry(entry)}
                        aria-label="Kontynuuj wyszukiwanie"
                        title="Kontynuuj wyszukiwanie"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-hover-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <MessageSquare className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleSaved(entry.id)}
                        aria-label="Zapisz"
                        title="Zapisz"
                        aria-pressed={savedIds.has(entry.id)}
                        className={cn(
                          "inline-flex h-8 w-8 items-center justify-center rounded-lg border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          savedIds.has(entry.id)
                            ? "border-foreground/30 bg-surface-secondary text-foreground"
                            : "border-border text-muted-foreground hover:bg-hover-surface hover:text-foreground",
                        )}
                      >
                        <Bookmark className={cn("h-4 w-4", savedIds.has(entry.id) ? "fill-current" : undefined)} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteEntry(entry)}
                        aria-label="Usuń z historii"
                        title="Usuń z historii"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-hover-surface hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          );
        })}

        {filtered.length === 0 ? (
          <p className="rounded-xl border border-border/80 bg-surface-secondary/40 px-4 py-6 text-center text-sm text-muted-foreground">
            Brak wyników pasujących do wybranych filtrów.
          </p>
        ) : null}
      </div>

      <Modal
        open={detailsEntry !== null}
        onClose={() => setDetailsEntry(null)}
        title="Szczegóły wyszukiwania"
        description={detailsEntry?.title}
      >
        {detailsEntry ? (
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Podgląd odpowiedzi</p>
              <p className="mt-1.5 text-foreground">{detailsEntry.answerPreview}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
              <div>
                <p className="uppercase tracking-[0.14em]">Liczba źródeł</p>
                <p className="mt-1 text-sm text-foreground">{detailsEntry.sourceCount}</p>
              </div>
              <div>
                <p className="uppercase tracking-[0.14em]">Wyszukano</p>
                <p className="mt-1 text-sm text-foreground">{detailsEntry.timeLabel}</p>
              </div>
              <div className="col-span-2">
                <p className="uppercase tracking-[0.14em]">Stan prawny na</p>
                <p className="mt-1 text-sm text-foreground">{detailsEntry.legalStateDate}</p>
              </div>
            </div>
            <button
              type="button"
              disabled
              title="Podgląd demonstracyjny — pełna odpowiedź nie jest dostępna z poziomu historii w tym wydaniu"
              className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm font-medium text-muted-foreground opacity-70"
            >
              Otwórz pełną odpowiedź
            </button>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={continueEntry !== null}
        onClose={() => {
          setContinueEntry(null);
          setFollowUp("");
        }}
        title="Kontynuuj wyszukiwanie"
        description={continueEntry?.title}
      >
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="block text-muted-foreground">Pytanie uzupełniające</span>
            <Input
              value={followUp}
              onChange={(event) => setFollowUp(event.target.value)}
              placeholder="Np. A co jeśli umowa nie została zawarta na piśmie?"
              className="mt-2 h-10 bg-surface-secondary"
            />
          </label>
          <button
            type="button"
            disabled
            title="Podgląd demonstracyjny — kontynuacja z poziomu historii nie jest jeszcze podłączona do wyszukiwarki"
            className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm font-medium text-muted-foreground opacity-70"
          >
            Wyślij pytanie uzupełniające
          </button>
        </div>
      </Modal>

      <Modal open={deleteEntry !== null} onClose={() => setDeleteEntry(null)} title="Usuń z historii" description={deleteEntry?.title}>
        <div className="space-y-4 text-sm text-muted-foreground">
          <p>Ten wpis zostanie usunięty z widoku historii w tym podglądzie interfejsu. To działanie nie usuwa żadnych rzeczywistych danych.</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteEntry(null)}
              className="rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface"
            >
              Anuluj
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground transition hover:bg-destructive/20"
            >
              Usuń wpis
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={clearOpen} onClose={() => setClearOpen(false)} title="Wyczyść historię" description="Wybierz zakres do wyczyszczenia w tym podglądzie interfejsu.">
        <div className="space-y-4">
          <div className="space-y-1.5">
            {CLEAR_SCOPE_OPTIONS.map((option) => (
              <label key={option.value} className="flex items-center gap-2.5 text-sm text-foreground">
                <input
                  type="radio"
                  name="clear-scope"
                  checked={clearSelection.scope === option.value}
                  onChange={() => setClearSelection((prev) => ({ ...prev, scope: option.value }))}
                  className="h-4 w-4 border border-border bg-surface-secondary"
                />
                {option.label}
              </label>
            ))}
          </div>

          {clearSelection.scope === "custom" ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-muted-foreground">
                Od
                <Input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="mt-1.5 h-9 bg-surface-secondary" />
              </label>
              <label className="block text-xs text-muted-foreground">
                Do
                <Input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="mt-1.5 h-9 bg-surface-secondary" />
              </label>
            </div>
          ) : null}

          <SwitchToggle
            checked={clearSelection.preserveSaved}
            onChange={(checked) => setClearSelection((prev) => ({ ...prev, preserveSaved: checked }))}
            label="Zachowaj zapisane wpisy"
            description="Wpisy oznaczone jako zapisane nie zostaną usunięte."
          />

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setClearOpen(false)} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface">
              Anuluj
            </button>
            <button
              type="button"
              onClick={confirmClear}
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground transition hover:bg-destructive/20"
            >
              Wyczyść historię
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
