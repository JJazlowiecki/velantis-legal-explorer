import { Check } from "lucide-react";

import { CheckoutButton } from "@/components/billing/checkout-button";
import { ManageBillingButton } from "@/components/billing/manage-billing-button";
import { Panel } from "@/components/explorer/panel";
import { SectionHeader } from "@/components/section-header";
import { StatusBadge } from "@/components/status-badge";
import { PLAN_ORDER, PLANS, type PlanId } from "@/lib/billing/plans";
import type { AccountBillingSnapshot } from "@/lib/billing/account-data";
import { cn } from "@/lib/utils";

function featuresFor(planId: PlanId): string[] {
  const plan = PLANS[planId];
  return [`${plan.monthlyQueryLimit} zapytań Explorer / miesiąc`, "Dostęp do pełnego korpusu aktualnego prawa", "Historia i zapisane odpowiedzi"];
}

export function PlanPageContent({ snapshot }: { snapshot: AccountBillingSnapshot }) {
  const { entitlement, usage, billingConfigured } = snapshot;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <SectionHeader eyebrow="Velantis Legal Explorer" title="Plany" description="Wybierz plan dopasowany do liczby zapytań, których potrzebujesz." />

      <Panel title="Bieżące wykorzystanie">
        <p className="text-sm text-foreground">
          {usage.used} / {usage.limit} zapytań wykorzystanych w bieżącym okresie ({usage.periodStart.toLocaleDateString("pl-PL")} –{" "}
          {usage.periodEnd.toLocaleDateString("pl-PL")})
        </p>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-secondary">
          <div
            className="h-full rounded-full bg-foreground transition-all"
            style={{ width: `${usage.limit > 0 ? Math.min(100, (usage.used / usage.limit) * 100) : 0}%` }}
          />
        </div>
      </Panel>

      {!billingConfigured ? (
        <Panel className="border-border/80">
          <p className="text-sm text-muted-foreground">
            Płatności nie są jeszcze skonfigurowane w tym środowisku — plan FREE działa w pełni, plany płatne będą dostępne po skonfigurowaniu Stripe.
          </p>
        </Panel>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        {PLAN_ORDER.map((planId) => {
          const plan = PLANS[planId];
          const isCurrent = entitlement.planId === planId;
          return (
            <article
              key={plan.id}
              className={cn(
                "flex flex-col rounded-2xl border p-6",
                isCurrent ? "border-foreground/25 bg-surface-elevated shadow-[0_24px_35px_-28px_rgba(0,0,0,0.95)]" : "border-border bg-surface",
              )}
            >
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-semibold text-foreground">{plan.name}</h4>
                {isCurrent ? <StatusBadge tone="success">Twój plan</StatusBadge> : null}
              </div>
              <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{plan.displayPrice}</p>
              <ul className="mt-6 flex-1 space-y-3">
                {featuresFor(planId).map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6">
                {isCurrent && planId !== "free" ? (
                  <ManageBillingButton
                    disabled={!billingConfigured}
                    className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm font-medium text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                  />
                ) : isCurrent ? (
                  <p className="text-center text-xs text-muted-foreground">Plan bezpłatny — bez konfiguracji płatności.</p>
                ) : planId === "free" ? (
                  <p className="text-center text-xs text-muted-foreground">Dostępny po anulowaniu bieżącej subskrypcji.</p>
                ) : (
                  <CheckoutButton
                    planId={planId}
                    disabled={!billingConfigured}
                    className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm font-medium text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                  />
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
