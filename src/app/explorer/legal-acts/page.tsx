import { AppShell } from "@/components/layout/app-shell";
import { LegalActsPageContent } from "@/components/explorer/pages/legal-acts-page-content";
import { listLegalActFilterOptions, listLegalActs } from "@/lib/explorer/legal-acts/service";
import { getDb } from "@/db";

// Reflects live DB state (acts can be added by future ingestion runs) — never statically
// prerender a snapshot of what's currently ingested.
export const dynamic = "force-dynamic";

export default async function ExplorerLegalActsPage() {
  const db = getDb();
  const [initialItems, filterOptions] = await Promise.all([
    listLegalActs({ db, jurisdiction: "PL" }),
    listLegalActFilterOptions({ db, jurisdiction: "PL" }),
  ]);

  return (
    <AppShell>
      <LegalActsPageContent initialItems={initialItems} initialFilterOptions={filterOptions} />
    </AppShell>
  );
}
