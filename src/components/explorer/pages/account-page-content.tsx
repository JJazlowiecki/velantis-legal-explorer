import Link from "next/link";
import { CalendarClock, Gauge, Mail, ShieldCheck } from "lucide-react";

import { LogoutButton } from "@/components/auth/logout-button";
import { ManageBillingButton } from "@/components/billing/manage-billing-button";
import { Panel } from "@/components/explorer/panel";
import { SectionHeader } from "@/components/section-header";
import { PLANS } from "@/lib/billing/plans";
import type { AccountBillingSnapshot } from "@/lib/billing/account-data";

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString("pl-PL", { year: "numeric", month: "long", day: "numeric" });
}

const STATUS_LABELS: Record<string, string> = {
  active: "Aktywna",
  trialing: "Okres próbny",
  canceled: "Anulowana",
  incomplete: "Niedokończona",
  incomplete_expired: "Wygasła",
  past_due: "Zaległa płatność",
  paused: "Wstrzymana",
  unpaid: "Nieopłacona",
};

export function AccountPageContent({ snapshot }: { snapshot: AccountBillingSnapshot }) {
  const { email, entitlement, usage, billingConfigured } = snapshot;
  const plan = PLANS[entitlement.planId];
  const isPaid = entitlement.planId !== "free";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <SectionHeader eyebrow="Velantis Legal Explorer" title="Konto" description="Twoje dane, plan i wykorzystanie limitu zapytań." />

      <Panel title="Profil">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border bg-surface-secondary text-base font-semibold text-foreground">
            {email.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
              <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {email}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              {snapshot.emailVerified ? "E-mail potwierdzony" : "E-mail niepotwierdzony"}
            </p>
          </div>
        </div>
      </Panel>

      <Panel
        title="Plan i płatności"
        action={
          isPaid && billingConfigured ? (
            <ManageBillingButton className="rounded-lg border border-border bg-surface-secondary px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          ) : (
            <Link
              href="/explorer/plan"
              className="rounded-lg border border-border bg-surface-secondary px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Zobacz plany
            </Link>
          )
        }
      >
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Aktualny plan</dt>
            <dd className="mt-1 text-sm text-foreground">
              {plan.name} · {plan.displayPrice}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Status subskrypcji</dt>
            <dd className="mt-1 text-sm text-foreground">
              {entitlement.subscriptionStatus ? STATUS_LABELS[entitlement.subscriptionStatus] ?? entitlement.subscriptionStatus : "Brak subskrypcji"}
              {entitlement.cancelAtPeriodEnd ? " (kończy się na koniec okresu)" : ""}
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              Koniec okresu rozliczeniowego
            </dt>
            <dd className="mt-1 text-sm text-foreground">{formatDate(entitlement.periodEnd)}</dd>
          </div>
        </dl>
        {!billingConfigured ? (
          <p className="mt-4 rounded-lg border border-border bg-surface-secondary px-3 py-2 text-xs text-muted-foreground">
            Płatności nie są jeszcze skonfigurowane w tym środowisku.
          </p>
        ) : null}
      </Panel>

      <Panel title="Wykorzystanie zapytań w tym miesiącu">
        <dl className="grid gap-4 sm:grid-cols-4">
          <div>
            <dt className="flex items-center gap-1.5 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <Gauge className="h-3.5 w-3.5" />
              Limit
            </dt>
            <dd className="mt-1 text-sm text-foreground">{usage.limit}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Wykorzystane</dt>
            <dd className="mt-1 text-sm text-foreground">{usage.used}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Pozostałe</dt>
            <dd className="mt-1 text-sm text-foreground">{usage.remaining}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Okres</dt>
            <dd className="mt-1 text-sm text-foreground">
              {formatDate(usage.periodStart)} – {formatDate(usage.periodEnd)}
            </dd>
          </div>
        </dl>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-surface-secondary">
          <div
            className="h-full rounded-full bg-foreground transition-all"
            style={{ width: `${usage.limit > 0 ? Math.min(100, (usage.used / usage.limit) * 100) : 0}%` }}
          />
        </div>
      </Panel>

      <Panel title="Sesja">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Wyloguj się z tego urządzenia.</p>
          <LogoutButton className="shrink-0 rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </div>
      </Panel>
    </div>
  );
}
