import { AppShell } from "@/components/layout/app-shell";
import { PlanPageContent } from "@/components/explorer/pages/plan-page-content";
import { loadAccountBillingSnapshot } from "@/lib/billing/account-data";

export default async function ExplorerPlanPage() {
  const snapshot = await loadAccountBillingSnapshot();

  return (
    <AppShell>
      <PlanPageContent snapshot={snapshot} />
    </AppShell>
  );
}
