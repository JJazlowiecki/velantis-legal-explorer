"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Calendar, Eye, FileText, MessageSquare, Search, Trash2 } from "lucide-react";

import { clearExplorerHistory, deleteExplorerHistoryEntry, listExplorerHistory } from "@/app/explorer/history/actions";
import { FormSelect } from "@/components/explorer/form-select";
import { Modal } from "@/components/explorer/modal";
import { Panel } from "@/components/explorer/panel";
import { SectionHeader } from "@/components/section-header";
import { Input } from "@/components/ui/input";
import { buildContinueSearchHref } from "@/lib/explorer/continue-search";
import { HISTORY_GROUP_LABELS, HISTORY_GROUP_ORDER, classifyHistoryGroup } from "@/lib/explorer/history/grouping";
import { DEFAULT_HISTORY_LIST_FILTERS, filterHistoryListItems, type HistoryListFilters } from "@/lib/explorer/history/list-filters";
import type { HistoryListItem } from "@/lib/explorer/history/list-view";
import type { ClearHistoryScope } from "@/lib/explorer/history/service";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<HistoryListItem["status"], string> = {
  answered: "Odpowiedź",
  insufficient_evidence: "Brak wystarczających źródeł",
};

const CLEAR_SCOPE_OPTIONS: { value: ClearHistoryScope; label: string }[] = [
  { value: "all", label: "Cała historia" },
  { value: "last_7_days", label: "Ostatnie 7 dni" },
  { value: "last_30_days", label: "Ostatnie 30 dni" },
  { value: "custom", label: "Zakres niestandardowy" },
];

interface HistoryPageContentProps {
  initialEntries: HistoryListItem[];
  historyEnabled: boolean;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pl-PL", { dateStyle: "medium", timeStyle: "short" });
}

export function HistoryPageContent({ initialEntries, historyEnabled }: HistoryPageContentProps) {
  const [entries, setEntries] = useState<HistoryListItem[]>(initialEntries);
  const [filters, setFilters] = useState<HistoryListFilters>(DEFAULT_HISTORY_LIST_FILTERS);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [detailsItem, setDetailsItem] = useState<HistoryListItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<HistoryListItem | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const [clearOpen, setClearOpen] = useState(false);
  const [clearScope, setClearScope] = useState<ClearHistoryScope>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [clearPending, setClearPending] = useState(false);
  const [clearConfirmation, setClearConfirmation] = useState<string | null>(null);

  const now = useMemo(() => new Date(), []);
  const filtered = useMemo(() => filterHistoryListItems(entries, filters, now), [entries, filters, now]);

  const grouped = useMemo(() => {
    const map = new Map<string, HistoryListItem[]>();
    for (const group of HISTORY_GROUP_ORDER) {
      map.set(group, []);
    }
    for (const item of filtered) {
      map.get(classifyHistoryGroup(new Date(item.createdAt), now))?.push(item);
    }
    return map;
  }, [filtered, now]);

  async function refreshEntries() {
    setIsRefreshing(true);
    try {
      setEntries(await listExplorerHistory());
    } finally {
      setIsRefreshing(false);
    }
  }

  async function confirmDelete() {
    if (!deleteItem) return;
    setDeletePending(true);
    try {
      await deleteExplorerHistoryEntry(deleteItem.id);
      setEntries((prev) => prev.filter((entry) => entry.id !== deleteItem.id));
      setDeleteItem(null);
    } finally {
      setDeletePending(false);
    }
  }

  async function confirmClear() {
    setClearPending(true);
    try {
      await clearExplorerHistory({
        scope: clearScope,
        from: clearScope === "custom" && customFrom ? new Date(customFrom).toISOString() : undefined,
        to: clearScope === "custom" && customTo ? new Date(customTo).toISOString() : undefined,
      });
      await refreshEntries();
      setClearOpen(false);
      setClearConfirmation("Historia wyszukiwań została wyczyszczona.");
    } finally {
      setClearPending(false);
    }
  }

  if (!historyEnabled) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <SectionHeader eyebrow="Velantis Legal Explorer" title="Historia" description="Przegląd Twoich ostatnich wyszukiwań i odpowiedzi." />
        <Panel className="text-center">
          <p className="text-sm text-foreground">Historia wyszukiwań jest wyłączona w tej instancji.</p>
          <p className="mt-1.5 text-sm text-muted-foreground">Wyszukiwanie na stronie /explorer nadal działa normalnie — wyniki po prostu nie są zapisywane.</p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <SectionHeader eyebrow="Velantis Legal Explorer" title="Historia" description="Przegląd Twoich ostatnich wyszukiwań i odpowiedzi." />

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
            onChange={(value) => setFilters((prev) => ({ ...prev, group: value as HistoryListFilters["group"] }))}
            options={[
              { value: "all", label: "Wszystkie daty" },
              ...HISTORY_GROUP_ORDER.map((group) => ({ value: group, label: HISTORY_GROUP_LABELS[group] })),
            ]}
          />

          <FormSelect
            label=""
            className="md:w-56"
            value={filters.status}
            onChange={(value) => setFilters((prev) => ({ ...prev, status: value as HistoryListFilters["status"] }))}
            options={[
              { value: "all", label: "Wszystkie wyniki" },
              { value: "answered", label: STATUS_LABELS.answered },
              { value: "insufficient_evidence", label: STATUS_LABELS.insufficient_evidence },
            ]}
          />
        </div>

        <button
          type="button"
          onClick={() => setClearOpen(true)}
          disabled={entries.length === 0}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:self-auto"
        >
          <Trash2 className="h-4 w-4" />
          Wyczyść historię
        </button>
      </Panel>

      {clearConfirmation ? (
        <p className="rounded-xl border border-border/80 bg-surface-secondary/60 px-4 py-2.5 text-sm text-muted-foreground">{clearConfirmation}</p>
      ) : null}

      <div className="flex flex-col gap-8">
        {HISTORY_GROUP_ORDER.map((group) => {
          const groupEntries = grouped.get(group) ?? [];
          if (groupEntries.length === 0) return null;

          return (
            <div key={group}>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{HISTORY_GROUP_LABELS[group]}</h3>
              <div className="flex flex-col gap-2">
                {groupEntries.map((item) => (
                  <article
                    key={item.id}
                    className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                            item.status === "answered"
                              ? "border-border bg-surface-secondary text-foreground"
                              : "border-border/80 text-muted-foreground",
                          )}
                        >
                          <FileText className="h-3 w-3" />
                          {STATUS_LABELS[item.status]}
                        </span>
                        <span className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</span>
                      </div>
                      <p className="mt-1.5 truncate text-sm font-medium text-foreground">{item.query}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{item.sourceCount} źródeł</p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setDetailsItem(item)}
                        aria-label="Szczegóły wyszukiwania"
                        title="Szczegóły wyszukiwania"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-hover-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <Link
                        href={buildContinueSearchHref(item.query)}
                        aria-label="Kontynuuj wyszukiwanie"
                        title="Kontynuuj wyszukiwanie"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-hover-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <MessageSquare className="h-4 w-4" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => setDeleteItem(item)}
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

        {filtered.length === 0 && !isRefreshing ? (
          <p className="rounded-xl border border-border/80 bg-surface-secondary/40 px-4 py-6 text-center text-sm text-muted-foreground">
            {entries.length === 0
              ? "Brak zapisanej historii. Uruchom wyszukiwanie na stronie /explorer, aby zobaczyć je tutaj."
              : "Brak wyników pasujących do wybranych filtrów."}
          </p>
        ) : null}
      </div>

      <Modal open={detailsItem !== null} onClose={() => setDetailsItem(null)} title="Szczegóły wyszukiwania" description={detailsItem?.query}>
        {detailsItem ? (
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Podgląd odpowiedzi</p>
              <p className="mt-1.5 text-foreground">{detailsItem.answerPreview}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
              <div>
                <p className="uppercase tracking-[0.14em]">Status</p>
                <p className="mt-1 text-sm text-foreground">{STATUS_LABELS[detailsItem.status]}</p>
              </div>
              <div>
                <p className="uppercase tracking-[0.14em]">Liczba źródeł</p>
                <p className="mt-1 text-sm text-foreground">{detailsItem.sourceCount}</p>
              </div>
              <div className="col-span-2 flex items-center gap-1.5">
                <Calendar className="h-3 w-3" />
                <span>Wyszukano: {formatDateTime(detailsItem.createdAt)}</span>
              </div>
            </div>
            <Link
              href={`/explorer/history/${detailsItem.id}`}
              className="block w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-center text-sm font-medium text-foreground transition hover:bg-hover-surface"
            >
              Otwórz pełną odpowiedź
            </Link>
          </div>
        ) : null}
      </Modal>

      <Modal open={deleteItem !== null} onClose={() => setDeleteItem(null)} title="Usuń z historii" description={deleteItem?.query}>
        <div className="space-y-4 text-sm text-muted-foreground">
          <p>Ten wpis zostanie trwale usunięty z Twojej historii.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDeleteItem(null)} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface">
              Anuluj
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deletePending}
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground transition hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deletePending ? "Usuwanie…" : "Usuń wpis"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={clearOpen} onClose={() => setClearOpen(false)} title="Wyczyść historię" description="Wybierz zakres do wyczyszczenia.">
        <div className="space-y-4">
          <div className="space-y-1.5">
            {CLEAR_SCOPE_OPTIONS.map((option) => (
              <label key={option.value} className="flex items-center gap-2.5 text-sm text-foreground">
                <input
                  type="radio"
                  name="clear-scope"
                  checked={clearScope === option.value}
                  onChange={() => setClearScope(option.value)}
                  className="h-4 w-4 border border-border bg-surface-secondary"
                />
                {option.label}
              </label>
            ))}
          </div>

          {clearScope === "custom" ? (
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

          <p className="text-xs text-muted-foreground">
            Zapisane elementy nie są jeszcze obsługiwane w Velantis Legal Explorer, więc czyszczenie historii obejmuje wszystkie pasujące wpisy.
          </p>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setClearOpen(false)} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface">
              Anuluj
            </button>
            <button
              type="button"
              onClick={confirmClear}
              disabled={clearPending || (clearScope === "custom" && (!customFrom || !customTo))}
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground transition hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {clearPending ? "Czyszczenie…" : "Wyczyść historię"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
