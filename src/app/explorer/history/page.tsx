import { AppShell } from "@/components/layout/app-shell";
import { HistoryPageContent } from "@/components/explorer/pages/history-page-content";
import { getServerEnv } from "@/lib/env/server";
import { listExplorerHistory } from "./actions";

export default async function ExplorerHistoryPage() {
  const env = getServerEnv();
  const initialEntries = env.EXPLORER_HISTORY_ENABLED ? await listExplorerHistory() : [];

  return (
    <AppShell>
      <HistoryPageContent
        initialEntries={initialEntries}
        historyEnabled={env.EXPLORER_HISTORY_ENABLED}
        retentionDays={env.EXPLORER_HISTORY_RETENTION_DAYS}
      />
    </AppShell>
  );
}
