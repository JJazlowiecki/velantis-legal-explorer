"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Bookmark, FileText, Folder, FolderPlus, MoreVertical, Pencil, Search, ShieldAlert, Trash2 } from "lucide-react";

import {
  createSavedFolderAction,
  deleteSavedFolderAction,
  deleteSavedItemAction,
  getSavedItemDetail,
  listSaved,
  moveSavedItemAction,
  renameSavedFolderAction,
  type SavedItemDetail,
} from "@/app/explorer/saved/actions";
import { FormSelect } from "@/components/explorer/form-select";
import { Modal } from "@/components/explorer/modal";
import { Panel } from "@/components/explorer/panel";
import { TabGroup } from "@/components/explorer/tab-group";
import { SectionHeader } from "@/components/section-header";
import { Input } from "@/components/ui/input";
import { buildContinueSearchHref } from "@/lib/explorer/continue-search";
import {
  DEFAULT_SAVED_LIST_FILTERS,
  filterAndSortSavedListItems,
  SAVED_SORT_LABELS,
  SAVED_TABS,
  SAVED_TAB_LABELS,
  type SavedListFilters,
  type SavedSort,
} from "@/lib/explorer/saved/list-filters";
import type { SavedListItem } from "@/lib/explorer/saved/list-view";
import type { SavedFolderRecord, SavedUsage } from "@/lib/explorer/saved/service";
import type { SavedAnswerSnapshot, SavedProvisionSnapshot, SavedSearchSnapshot } from "@/lib/explorer/saved/snapshot";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<SavedListItem["kind"], string> = {
  answer: "Odpowiedź",
  provision: "Przepis",
  search: "Wyszukiwanie",
};

interface SavedPageContentProps {
  initialItems: SavedListItem[];
  initialFolders: SavedFolderRecord[];
  initialUsage: SavedUsage;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pl-PL", { dateStyle: "medium", timeStyle: "short" });
}

export function SavedPageContent({ initialItems, initialFolders, initialUsage }: SavedPageContentProps) {
  const [items, setItems] = useState<SavedListItem[]>(initialItems);
  const [folders, setFolders] = useState<SavedFolderRecord[]>(initialFolders);
  const [usage, setUsage] = useState<SavedUsage>(initialUsage);
  const [filters, setFilters] = useState<SavedListFilters>(DEFAULT_SAVED_LIST_FILTERS);
  const [isPending, startTransition] = useTransition();

  const [previewItem, setPreviewItem] = useState<SavedListItem | null>(null);
  const [previewDetail, setPreviewDetail] = useState<SavedItemDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [moveItem, setMoveItem] = useState<SavedListItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<SavedListItem | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<SavedFolderRecord | null>(null);
  const [renameFolderTarget, setRenameFolderTarget] = useState<SavedFolderRecord | null>(null);
  const [renameFolderName, setRenameFolderName] = useState("");
  const [renameFolderError, setRenameFolderError] = useState<string | null>(null);

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);

  const visible = useMemo(() => filterAndSortSavedListItems(items, filters), [items, filters]);

  async function refresh() {
    const payload = await listSaved();
    setItems(payload.items);
    setFolders(payload.folders);
    setUsage(payload.usage);
  }

  function folderName(folderId: string | null): string {
    if (!folderId) return "Bez folderu";
    return folders.find((folder) => folder.id === folderId)?.name ?? "Bez folderu";
  }

  function createFolder() {
    setFolderError(null);
    startTransition(async () => {
      const result = await createSavedFolderAction(newFolderName);
      if (result.status === "created") {
        setNewFolderName("");
        setNewFolderOpen(false);
        await refresh();
        return;
      }
      if (result.status === "invalid_name") setFolderError("Podaj nazwę folderu (maks. 80 znaków).");
      else if (result.status === "duplicate_name") setFolderError("Masz już folder o tej nazwie.");
      else if (result.status === "limit_exceeded") setFolderError(`Osiągnięto limit ${result.limit} folderów.`);
      else setFolderError("Nie udało się utworzyć folderu. Spróbuj ponownie.");
    });
  }

  function moveToFolder(folderId: string | null) {
    if (!moveItem) return;
    const id = moveItem.id;
    startTransition(async () => {
      await moveSavedItemAction(id, folderId);
      setMoveItem(null);
      await refresh();
    });
  }

  function confirmDelete() {
    if (!deleteItem) return;
    const id = deleteItem.id;
    startTransition(async () => {
      await deleteSavedItemAction(id);
      setDeleteItem(null);
      await refresh();
    });
  }

  function confirmDeleteFolder() {
    if (!deleteFolderTarget) return;
    const id = deleteFolderTarget.id;
    startTransition(async () => {
      await deleteSavedFolderAction(id);
      setDeleteFolderTarget(null);
      if (filters.folderId === id) {
        setFilters((prev) => ({ ...prev, folderId: "all" }));
      }
      await refresh();
    });
  }

  async function openPreview(item: SavedListItem) {
    setPreviewItem(item);
    setPreviewDetail(null);
    setPreviewLoading(true);
    try {
      setPreviewDetail(await getSavedItemDetail(item.id));
    } finally {
      setPreviewLoading(false);
    }
  }

  function closePreview() {
    setPreviewItem(null);
    setPreviewDetail(null);
  }

  function openRenameFolder(folder: SavedFolderRecord) {
    setRenameFolderError(null);
    setRenameFolderName(folder.name);
    setRenameFolderTarget(folder);
  }

  function renameFolder() {
    if (!renameFolderTarget) return;
    setRenameFolderError(null);
    const id = renameFolderTarget.id;
    startTransition(async () => {
      const result = await renameSavedFolderAction(id, renameFolderName);
      if (result.status === "renamed") {
        setRenameFolderTarget(null);
        await refresh();
        return;
      }
      if (result.status === "not_found") setRenameFolderError("Ten folder już nie istnieje.");
      else if (result.status === "invalid_name") setRenameFolderError("Podaj nazwę folderu (maks. 80 znaków).");
      else if (result.status === "duplicate_name") setRenameFolderError("Masz już folder o tej nazwie.");
      else setRenameFolderError("Nie udało się zmienić nazwy. Spróbuj ponownie.");
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <SectionHeader
        eyebrow="Velantis Legal Explorer"
        title="Zapisane"
        description="Twoje zapisane odpowiedzi, przepisy i wyszukiwania."
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-surface-secondary px-2.5 py-1 text-[11px] text-muted-foreground">
            <Bookmark className="h-3 w-3 shrink-0" aria-hidden="true" />
            Zapisane: {usage.count} / {usage.max}
          </span>
        }
      />

      {usage.count >= usage.max ? (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
          Osiągnięto limit zapisanych elementów ({usage.max}). Usuń część zapisanych, aby dodać nowe — istniejące elementy pozostają nienaruszone.
        </p>
      ) : null}

      <Panel className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1 md:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filters.searchTerm}
              onChange={(event) => setFilters((prev) => ({ ...prev, searchTerm: event.target.value }))}
              placeholder="Szukaj w zapisanych..."
              className="h-9 bg-surface-secondary pl-8"
            />
          </div>
          <FormSelect
            label=""
            className="md:w-56"
            value={filters.sort}
            onChange={(value) => setFilters((prev) => ({ ...prev, sort: value as SavedSort }))}
            options={Object.entries(SAVED_SORT_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </div>

        <button
          type="button"
          onClick={() => {
            setFolderError(null);
            setNewFolderOpen(true);
          }}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:self-auto"
        >
          <FolderPlus className="h-4 w-4" />
          Nowy folder
        </button>
      </Panel>

      <TabGroup
        options={SAVED_TABS.map((tab) => ({ value: tab, label: SAVED_TAB_LABELS[tab] }))}
        value={filters.tab}
        onChange={(tab) => setFilters((prev) => ({ ...prev, tab }))}
      />

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        <button
          type="button"
          onClick={() => setFilters((prev) => ({ ...prev, folderId: "all" }))}
          className={cn(
            "rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            filters.folderId === "all" ? "border-foreground/30 bg-surface-secondary" : "border-border bg-surface hover:bg-hover-surface",
          )}
        >
          <Folder className="h-4 w-4 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium text-foreground">Wszystkie foldery</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{items.length} elementów</p>
        </button>
        {folders.map((folder) => (
          <div
            key={folder.id}
            className={cn(
              "group relative rounded-xl border p-4 text-left transition",
              filters.folderId === folder.id ? "border-foreground/30 bg-surface-secondary" : "border-border bg-surface hover:bg-hover-surface",
            )}
          >
            <button
              type="button"
              onClick={() => setFilters((prev) => ({ ...prev, folderId: folder.id }))}
              className="block w-full text-left focus-visible:outline-none"
            >
              <Folder className="h-4 w-4 text-muted-foreground" />
              <p className="mt-2 truncate pr-6 text-sm font-medium text-foreground">{folder.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{items.filter((item) => item.folderId === folder.id).length} elementów</p>
            </button>
            <div className="absolute right-2.5 top-2.5 hidden items-center gap-1 group-hover:flex">
              <button
                type="button"
                onClick={() => openRenameFolder(folder)}
                aria-label={`Zmień nazwę folderu ${folder.name}`}
                title="Zmień nazwę folderu"
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-hover-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setDeleteFolderTarget(folder)}
                aria-label={`Usuń folder ${folder.name}`}
                title="Usuń folder"
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-hover-surface hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <SavedItemsTable
        items={visible}
        folderName={folderName}
        onPreview={openPreview}
        onMove={setMoveItem}
        onDelete={setDeleteItem}
      />

      <Modal open={previewItem !== null} onClose={closePreview} title="Podgląd zapisanego elementu" description={previewItem?.title}>
        {previewLoading ? <p className="text-sm text-muted-foreground">Wczytywanie…</p> : null}
        {!previewLoading && previewDetail ? <SavedItemPreview detail={previewDetail} /> : null}
        {!previewLoading && !previewDetail && previewItem ? (
          <p className="text-sm text-muted-foreground">Nie udało się wczytać podglądu tego elementu.</p>
        ) : null}
      </Modal>

      <Modal open={moveItem !== null} onClose={() => setMoveItem(null)} title="Przenieś do folderu" description={moveItem?.title}>
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => moveToFolder(null)}
            disabled={isPending}
            className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm text-foreground transition hover:bg-hover-surface disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Folder className="h-4 w-4 text-muted-foreground" />
            Bez folderu
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => moveToFolder(folder.id)}
              disabled={isPending}
              className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm text-foreground transition hover:bg-hover-surface disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Folder className="h-4 w-4 text-muted-foreground" />
              {folder.name}
            </button>
          ))}
        </div>
      </Modal>

      <Modal open={deleteItem !== null} onClose={() => setDeleteItem(null)} title="Usuń z zapisanych" description={deleteItem?.title}>
        <div className="space-y-4 text-sm text-muted-foreground">
          <p>
            To usuwa element wyłącznie z Twoich <strong className="text-foreground">zapisanych</strong> — nie usuwa historii wyszukiwań,
            przepisu ani danych źródłowych, których dotyczy.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDeleteItem(null)} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface">
              Anuluj
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground transition hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              Usuń z zapisanych
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={deleteFolderTarget !== null} onClose={() => setDeleteFolderTarget(null)} title="Usuń folder" description={deleteFolderTarget?.name}>
        <div className="space-y-4 text-sm text-muted-foreground">
          <p>
            Zapisane elementy z tego folderu <strong className="text-foreground">pozostaną zapisane</strong> — zostaną przeniesione do
            &bdquo;Bez folderu&rdquo;. Sam folder zostanie usunięty.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDeleteFolderTarget(null)} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface">
              Anuluj
            </button>
            <button
              type="button"
              onClick={confirmDeleteFolder}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground transition hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              Usuń folder
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={newFolderOpen} onClose={() => setNewFolderOpen(false)} title="Nowy folder" description="Utwórz folder porządkujący zapisane elementy.">
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="block text-muted-foreground">Nazwa folderu</span>
            <Input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder="Np. Prawo podatkowe" className="mt-2 h-10 bg-surface-secondary" />
          </label>
          {folderError ? <p className="text-sm text-destructive">{folderError}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setNewFolderOpen(false)} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface">
              Anuluj
            </button>
            <button
              type="button"
              onClick={createFolder}
              disabled={newFolderName.trim().length === 0 || isPending}
              className="rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm font-medium text-foreground transition hover:bg-hover-surface disabled:cursor-not-allowed disabled:opacity-50"
            >
              Utwórz folder
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={renameFolderTarget !== null} onClose={() => setRenameFolderTarget(null)} title="Zmień nazwę folderu" description={renameFolderTarget?.name}>
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="block text-muted-foreground">Nazwa folderu</span>
            <Input value={renameFolderName} onChange={(event) => setRenameFolderName(event.target.value)} className="mt-2 h-10 bg-surface-secondary" />
          </label>
          {renameFolderError ? <p className="text-sm text-destructive">{renameFolderError}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setRenameFolderTarget(null)} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface">
              Anuluj
            </button>
            <button
              type="button"
              onClick={renameFolder}
              disabled={renameFolderName.trim().length === 0 || isPending}
              className="rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm font-medium text-foreground transition hover:bg-hover-surface disabled:cursor-not-allowed disabled:opacity-50"
            >
              Zapisz nazwę
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function SavedItemsTable({
  items,
  folderName,
  onPreview,
  onMove,
  onDelete,
}: {
  items: SavedListItem[];
  folderName: (folderId: string | null) => string;
  onPreview: (item: SavedListItem) => void;
  onMove: (item: SavedListItem) => void;
  onDelete: (item: SavedListItem) => void;
}) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  return (
    <Panel className="p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-[0.1em] text-muted-foreground">
              <th className="px-4 py-3 font-medium">Typ</th>
              <th className="px-4 py-3 font-medium">Tytuł</th>
              <th className="px-4 py-3 font-medium">Data zapisu</th>
              <th className="px-4 py-3 font-medium">Źródło / status</th>
              <th className="px-4 py-3 font-medium">Folder</th>
              <th className="px-4 py-3 font-medium text-right">Akcje</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-border/70 last:border-0 hover:bg-hover-surface/60">
                <td className="px-4 py-3 text-muted-foreground">{TYPE_LABELS[item.kind]}</td>
                <td className="max-w-[280px] truncate px-4 py-3 font-medium text-foreground">{item.title}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatDateTime(item.createdAt)}</td>
                <td className="px-4 py-3 text-muted-foreground">{item.sourceOrStatus}</td>
                <td className="px-4 py-3 text-muted-foreground">{folderName(item.folderId)}</td>
                <td className="relative px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => setOpenMenuId((prev) => (prev === item.id ? null : item.id))}
                    aria-label="Otwórz menu akcji"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-hover-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                  {openMenuId === item.id ? (
                    <div className="absolute right-4 top-11 z-10 w-44 rounded-lg border border-border bg-surface-elevated p-1 text-left shadow-[0_18px_28px_-20px_rgba(0,0,0,0.9)]">
                      <button
                        type="button"
                        onClick={() => {
                          onPreview(item);
                          setOpenMenuId(null);
                        }}
                        className="block w-full rounded-md px-2.5 py-1.5 text-sm text-foreground hover:bg-hover-surface"
                      >
                        Podgląd
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onMove(item);
                          setOpenMenuId(null);
                        }}
                        className="block w-full rounded-md px-2.5 py-1.5 text-sm text-foreground hover:bg-hover-surface"
                      >
                        Przenieś do folderu
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onDelete(item);
                          setOpenMenuId(null);
                        }}
                        className="block w-full rounded-md px-2.5 py-1.5 text-sm text-destructive hover:bg-hover-surface"
                      >
                        Usuń z zapisanych
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Brak zapisanych elementów pasujących do filtrów.</p>
        ) : null}
      </div>
    </Panel>
  );
}

function SavedItemPreview({ detail }: { detail: SavedItemDetail }) {
  if (detail.kind === "answer") {
    const snapshot = detail.snapshot as SavedAnswerSnapshot;
    return (
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
          <div>
            <p className="uppercase tracking-[0.14em]">Zapytanie</p>
            <p className="mt-1 text-sm text-foreground">{snapshot.query}</p>
          </div>
          <div>
            <p className="uppercase tracking-[0.14em]">Data zapisu</p>
            <p className="mt-1 text-sm text-foreground">{formatDateTime(detail.createdAt)}</p>
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Odpowiedź</p>
          <p className="mt-1.5 whitespace-pre-line text-foreground">{snapshot.answer}</p>
        </div>
        {snapshot.citedSources.length > 0 ? (
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Źródła</p>
            <ul className="mt-2 space-y-2">
              {snapshot.citedSources.map((source) => (
                <li key={`${source.actTitle}::${source.citationLabel}`} className="rounded-lg border border-border p-2.5">
                  <p className="text-sm font-medium text-foreground">
                    {source.citationLabel} <span className="font-normal text-muted-foreground">— {source.actTitle}</span>
                  </p>
                  {source.isNonAuthoritative || source.isCurrentnessUnproven ? (
                    <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-300">
                      <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
                      {source.isNonAuthoritative ? "Nieautorytatywne. " : ""}
                      {source.isCurrentnessUnproven ? "Aktualność niepotwierdzona." : ""}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {snapshot.uncertainties.length > 0 ? (
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Niepewności</p>
            <ul className="mt-1.5 space-y-1 text-muted-foreground">
              {snapshot.uncertainties.map((entry, index) => (
                <li key={index}>{entry}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {snapshot.alternativePaths.length > 0 ? (
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Niepotwierdzone możliwe kierunki</p>
            <ul className="mt-1.5 space-y-1 text-muted-foreground">
              {snapshot.alternativePaths.map((path, index) => (
                <li key={index}>
                  <span className="font-medium text-foreground">{path.issueLabel}:</span> {path.explanation}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }

  if (detail.kind === "provision") {
    const snapshot = detail.snapshot as SavedProvisionSnapshot;
    return (
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileText className="h-3.5 w-3.5" />
          {snapshot.citationLabel} — {snapshot.actTitle}
        </div>
        <p className="whitespace-pre-line text-foreground">{snapshot.text}</p>
        {snapshot.isNonAuthoritative || snapshot.isCurrentnessUnproven ? (
          <p className="flex items-start gap-1.5 text-xs text-amber-300">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {snapshot.isNonAuthoritative ? "Źródło nieautorytatywne — nie stanowi samodzielnie wiążącego prawa. " : ""}
              {snapshot.isCurrentnessUnproven ? "Aktualność tego przepisu nie została potwierdzona przez system." : ""}
            </span>
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">Zapisano: {formatDateTime(detail.createdAt)}</p>
      </div>
    );
  }

  const snapshot = detail.snapshot as SavedSearchSnapshot;
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Zapytanie</p>
        <p className="mt-1 text-foreground">{snapshot.query}</p>
      </div>
      <p className="text-xs text-muted-foreground">Zapisano: {formatDateTime(detail.createdAt)}</p>
      <Link
        href={buildContinueSearchHref(snapshot.query)}
        className="block w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-center text-sm font-medium text-foreground transition hover:bg-hover-surface"
      >
        Uruchom ponownie
      </Link>
    </div>
  );
}
