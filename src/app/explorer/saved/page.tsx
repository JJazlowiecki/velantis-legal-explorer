import { AppShell } from "@/components/layout/app-shell";
import { SavedPageContent } from "@/components/explorer/pages/saved-page-content";
import { listSaved } from "@/app/explorer/saved/actions";

export default async function ExplorerSavedPage() {
  const initial = await listSaved();

  return (
    <AppShell>
      <SavedPageContent initialItems={initial.items} initialFolders={initial.folders} initialUsage={initial.usage} />
    </AppShell>
  );
}
