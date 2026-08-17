import { AppShell } from "@/components/layout/app-shell";
import { AccountPageContent } from "@/components/explorer/pages/account-page-content";
import { loadAccountBillingSnapshot } from "@/lib/billing/account-data";

export default async function ExplorerAccountPage() {
  const snapshot = await loadAccountBillingSnapshot();

  return (
    <AppShell>
      <AccountPageContent snapshot={snapshot} />
    </AppShell>
  );
}
