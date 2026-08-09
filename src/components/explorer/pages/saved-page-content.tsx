"use client";

import { useMemo, useState } from "react";
import { Bookmark, Folder, FolderPlus, MoreVertical, Search, Trash2 } from "lucide-react";

import { DemoNotice } from "@/components/explorer/demo-notice";
import { FormSelect } from "@/components/explorer/form-select";
import { Modal } from "@/components/explorer/modal";
import { Panel } from "@/components/explorer/panel";
import { TabGroup } from "@/components/explorer/tab-group";
import { SectionHeader } from "@/components/section-header";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_SAVED_FILTERS,
  filterAndSortSavedItems,
  SAVED_SORT_LABELS,
  SAVED_TABS,
  SAVED_TAB_LABELS,
  type SavedFilters,
  type SavedSort,
} from "@/lib/explorer/demo/saved-filters";
import { DEMO_SAVED_FOLDERS, DEMO_SAVED_ITEMS, type SavedFolder, type SavedItem } from "@/lib/explorer/demo/saved";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<SavedItem["type"], string> = {
  answer: "Odpowiedź",
  provision: "Przepis",
  act: "Akt prawny",
  search: "Wyszukiwanie",
};

export function SavedPageContent() {
  const [items, setItems] = useState<SavedItem[]>(DEMO_SAVED_ITEMS);
  const [folders, setFolders] = useState<SavedFolder[]>(DEMO_SAVED_FOLDERS);
  const [filters, setFilters] = useState<SavedFilters>(DEFAULT_SAVED_FILTERS);

  const [previewItem, setPreviewItem] = useState<SavedItem | null>(null);
  const [moveItem, setMoveItem] = useState<SavedItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<SavedItem | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const visible = useMemo(() => filterAndSortSavedItems(items, filters), [items, filters]);

  function folderName(folderId: string | null): string {
    if (!folderId) return "Bez folderu";
    return folders.find((folder) => folder.id === folderId)?.name ?? "Bez folderu";
  }

  function createFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    const id = `f-${Date.now()}`;
    setFolders((prev) => [...prev, { id, name, itemCount: 0 }]);
    setNewFolderName("");
    setNewFolderOpen(false);
  }

  function moveToFolder(folderId: string | null) {
    if (!moveItem) return;
    setItems((prev) => prev.map((item) => (item.id === moveItem.id ? { ...item, folderId } : item)));
    setMoveItem(null);
  }

  function confirmDelete() {
    if (!deleteItem) return;
    setItems((prev) => prev.filter((item) => item.id !== deleteItem.id));
    setDeleteItem(null);
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <SectionHeader eyebrow="Velantis Legal Explorer" title="Zapisane" description="Twoje zapisane odpowiedzi, przepisy, akty i wyszukiwania." action={<DemoNotice />} />

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
          onClick={() => setNewFolderOpen(true)}
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
          <button
            key={folder.id}
            type="button"
            onClick={() => setFilters((prev) => ({ ...prev, folderId: folder.id }))}
            className={cn(
              "rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              filters.folderId === folder.id ? "border-foreground/30 bg-surface-secondary" : "border-border bg-surface hover:bg-hover-surface",
            )}
          >
            <Folder className="h-4 w-4 text-muted-foreground" />
            <p className="mt-2 truncate text-sm font-medium text-foreground">{folder.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{items.filter((item) => item.folderId === folder.id).length} elementów</p>
          </button>
        ))}
      </div>

      <Panel className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-[0.1em] text-muted-foreground">
                <th className="px-4 py-3 font-medium">Typ</th>
                <th className="px-4 py-3 font-medium">Tytuł</th>
                <th className="px-4 py-3 font-medium">Data zapisu</th>
                <th className="px-4 py-3 font-medium">Stan prawny na</th>
                <th className="px-4 py-3 font-medium">Źródło / status</th>
                <th className="px-4 py-3 font-medium">Folder</th>
                <th className="px-4 py-3 font-medium text-right">Akcje</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id} className="border-b border-border/70 last:border-0 hover:bg-hover-surface/60">
                  <td className="px-4 py-3 text-muted-foreground">{TYPE_LABELS[item.type]}</td>
                  <td className="max-w-[280px] truncate px-4 py-3 font-medium text-foreground">{item.title}</td>
                  <td className="px-4 py-3 text-muted-foreground">{item.savedDate}</td>
                  <td className="px-4 py-3 text-muted-foreground">{item.legalStateDate}</td>
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
                            setPreviewItem(item);
                            setOpenMenuId(null);
                          }}
                          className="block w-full rounded-md px-2.5 py-1.5 text-sm text-foreground hover:bg-hover-surface"
                        >
                          Podgląd
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMoveItem(item);
                            setOpenMenuId(null);
                          }}
                          className="block w-full rounded-md px-2.5 py-1.5 text-sm text-foreground hover:bg-hover-surface"
                        >
                          Przenieś do folderu
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteItem(item);
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
          {visible.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Brak zapisanych elementów pasujących do filtrów.</p>
          ) : null}
        </div>
      </Panel>

      <Modal open={previewItem !== null} onClose={() => setPreviewItem(null)} title="Podgląd zapisanego elementu" description={previewItem?.title}>
        {previewItem ? (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Bookmark className="h-3.5 w-3.5" />
              {TYPE_LABELS[previewItem.type]}
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
              <div>
                <p className="uppercase tracking-[0.14em]">Data zapisu</p>
                <p className="mt-1 text-sm text-foreground">{previewItem.savedDate}</p>
              </div>
              <div>
                <p className="uppercase tracking-[0.14em]">Stan prawny na</p>
                <p className="mt-1 text-sm text-foreground">{previewItem.legalStateDate}</p>
              </div>
              <div className="col-span-2">
                <p className="uppercase tracking-[0.14em]">Źródło / status</p>
                <p className="mt-1 text-sm text-foreground">{previewItem.sourceOrStatus}</p>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={moveItem !== null} onClose={() => setMoveItem(null)} title="Przenieś do folderu" description={moveItem?.title}>
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => moveToFolder(null)}
            className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm text-foreground transition hover:bg-hover-surface"
          >
            <Folder className="h-4 w-4 text-muted-foreground" />
            Bez folderu
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => moveToFolder(folder.id)}
              className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm text-foreground transition hover:bg-hover-surface"
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
            To usuwa element wyłącznie z Twoich <strong className="text-foreground">zapisanych</strong> w tym podglądzie interfejsu — nie usuwa
            odpowiedzi, przepisu ani aktu prawnego, którego dotyczy.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDeleteItem(null)} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface">
              Anuluj
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground transition hover:bg-destructive/20"
            >
              <Trash2 className="h-4 w-4" />
              Usuń z zapisanych
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={newFolderOpen} onClose={() => setNewFolderOpen(false)} title="Nowy folder" description="Utwórz folder porządkujący zapisane elementy w tym podglądzie interfejsu.">
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="block text-muted-foreground">Nazwa folderu</span>
            <Input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder="Np. Prawo podatkowe" className="mt-2 h-10 bg-surface-secondary" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setNewFolderOpen(false)} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface">
              Anuluj
            </button>
            <button
              type="button"
              onClick={createFolder}
              disabled={newFolderName.trim().length === 0}
              className="rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm font-medium text-foreground transition hover:bg-hover-surface disabled:cursor-not-allowed disabled:opacity-50"
            >
              Utwórz folder
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
