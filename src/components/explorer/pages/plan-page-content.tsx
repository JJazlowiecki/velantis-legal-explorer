"use client";

import { useState } from "react";
import { AlertTriangle, Check, CreditCard, FileText, ShieldAlert } from "lucide-react";

import { DemoNotice } from "@/components/explorer/demo-notice";
import { Modal } from "@/components/explorer/modal";
import { Panel } from "@/components/explorer/panel";
import { SectionHeader } from "@/components/section-header";
import { StatusBadge } from "@/components/status-badge";
import {
  DEMO_BILLING_DETAILS,
  DEMO_CURRENT_PLAN,
  DEMO_INVOICES,
  DEMO_PAYMENT_METHOD,
  DEMO_PLAN_OPTIONS,
  DEMO_USAGE_METRICS,
} from "@/lib/explorer/demo/plan";
import { cn } from "@/lib/utils";

export function PlanPageContent() {
  const [changePlanOpen, setChangePlanOpen] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState(DEMO_PLAN_OPTIONS.find((plan) => plan.current)?.id ?? DEMO_PLAN_OPTIONS[0].id);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [invoicesOpen, setInvoicesOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <SectionHeader eyebrow="Velantis Legal Explorer" title="Twój plan" description="Zarządzaj subskrypcją i sprawdzaj wykorzystanie limitów." action={<DemoNotice />} />

      <Panel>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-lg font-semibold text-foreground">{DEMO_CURRENT_PLAN.name}</p>
              <StatusBadge tone="success">{DEMO_CURRENT_PLAN.status}</StatusBadge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {DEMO_CURRENT_PLAN.price} <span>{DEMO_CURRENT_PLAN.period}</span>
            </p>
            <p className="mt-3 text-xs text-muted-foreground">Kolejne rozliczenie: {DEMO_CURRENT_PLAN.nextBillingDate}</p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">{DEMO_CURRENT_PLAN.renewalInfo}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedPlanId(DEMO_PLAN_OPTIONS.find((plan) => plan.current)?.id ?? DEMO_PLAN_OPTIONS[0].id);
              setChangePlanOpen(true);
            }}
            className="shrink-0 rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm font-medium text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Zmień plan
          </button>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {DEMO_USAGE_METRICS.map((metric) => (
          <Panel key={metric.id} className="p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{metric.label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              {metric.used}
              {metric.limit !== null ? <span className="text-sm font-normal text-muted-foreground"> / {metric.limit}</span> : null}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{metric.unit}</p>
          </Panel>
        ))}
      </div>

      <div>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Porównanie planów</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {DEMO_PLAN_OPTIONS.map((plan) => (
            <article
              key={plan.id}
              className={cn(
                "rounded-2xl border p-6",
                plan.current ? "border-foreground/25 bg-surface-elevated shadow-[0_24px_35px_-28px_rgba(0,0,0,0.95)]" : "border-border bg-surface",
              )}
            >
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-semibold text-foreground">{plan.name}</h4>
                {plan.current ? <StatusBadge tone="success">Twój plan</StatusBadge> : null}
              </div>
              <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">{plan.price}</p>
              <p className="mt-1 text-sm text-muted-foreground">{plan.period}</p>
              <ul className="mt-6 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check className="mt-0.5 h-4 w-4 text-foreground" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>

      <Panel title="Płatności">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <CreditCard className="h-3.5 w-3.5" />
              Metoda płatności
            </p>
            <p className="mt-1 text-sm text-foreground">{DEMO_PAYMENT_METHOD.brand} {DEMO_PAYMENT_METHOD.maskedNumber}</p>
            <button type="button" onClick={() => setPaymentOpen(true)} className="mt-2 text-xs text-foreground underline underline-offset-4">
              Zmień metodę płatności
            </button>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Dane rozliczeniowe</p>
            <p className="mt-1 text-sm text-foreground">{DEMO_BILLING_DETAILS.name}</p>
            <p className="text-xs text-muted-foreground">{DEMO_BILLING_DETAILS.address}</p>
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              Faktury
            </p>
            <button type="button" onClick={() => setInvoicesOpen(true)} className="mt-1 text-xs text-foreground underline underline-offset-4">
              Zobacz historię faktur
            </button>
          </div>
        </div>
      </Panel>

      <Modal open={changePlanOpen} onClose={() => setChangePlanOpen(false)} title="Zmień plan" description="Wybór planu w tym podglądzie interfejsu.">
        <div className="space-y-3">
          {DEMO_PLAN_OPTIONS.map((plan) => (
            <button
              key={plan.id}
              type="button"
              onClick={() => setSelectedPlanId(plan.id)}
              className={cn(
                "flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition",
                selectedPlanId === plan.id ? "border-foreground/30 bg-surface-secondary" : "border-border hover:bg-hover-surface",
              )}
            >
              <span>
                <span className="block text-sm font-medium text-foreground">{plan.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {plan.price} {plan.period}
                </span>
              </span>
              {selectedPlanId === plan.id ? <Check className="h-4 w-4 text-foreground" /> : null}
            </button>
          ))}
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            To jest podgląd interfejsu — nie istnieje jeszcze integracja płatności, więc zmiana planu nie zostanie faktycznie zastosowana.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setChangePlanOpen(false)} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface">
              Anuluj
            </button>
            <button
              type="button"
              disabled
              title="Funkcja demonstracyjna — zmiana planu nie jest jeszcze aktywna"
              className="rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm font-medium text-muted-foreground opacity-60"
            >
              Potwierdź zmianę
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={paymentOpen} onClose={() => setPaymentOpen(false)} title="Metoda płatności">
        <div className="space-y-4">
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Nie zbieramy ani nie przechowujemy rzeczywistych danych karty w tym podglądzie. Pola poniżej są wyłącznie demonstracyjne i wyłączone.
          </p>
          <label className="block text-sm">
            <span className="text-muted-foreground">Numer karty</span>
            <input
              type="text"
              value="4242 4242 4242 4242"
              disabled
              readOnly
              className="mt-2 h-10 w-full rounded-lg border border-input bg-surface-secondary px-2.5 text-sm text-muted-foreground opacity-70 outline-none"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-muted-foreground">Ważność</span>
              <input type="text" value="12/28" disabled readOnly className="mt-2 h-10 w-full rounded-lg border border-input bg-surface-secondary px-2.5 text-sm text-muted-foreground opacity-70 outline-none" />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">CVC</span>
              <input type="text" value="•••" disabled readOnly className="mt-2 h-10 w-full rounded-lg border border-input bg-surface-secondary px-2.5 text-sm text-muted-foreground opacity-70 outline-none" />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPaymentOpen(false)} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface">
              Zamknij
            </button>
            <button
              type="button"
              disabled
              title="Funkcja demonstracyjna — nie istnieje integracja płatności"
              className="rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm font-medium text-muted-foreground opacity-60"
            >
              Zapisz kartę
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={invoicesOpen} onClose={() => setInvoicesOpen(false)} title="Faktury" widthClassName="max-w-lg">
        <div className="space-y-4">
          <ul className="space-y-2">
            {DEMO_INVOICES.map((invoice) => (
              <li key={invoice.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <div>
                  <p className="text-foreground">{invoice.id}</p>
                  <p className="text-xs text-muted-foreground">{invoice.date}</p>
                </div>
                <div className="text-right">
                  <p className="text-foreground">{invoice.amount}</p>
                  <p className="text-xs text-muted-foreground">{invoice.status}</p>
                </div>
              </li>
            ))}
          </ul>
          <hr className="border-border" />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">Chcesz zrezygnować z subskrypcji?</p>
            <button
              type="button"
              onClick={() => setCancelConfirmOpen(true)}
              className="shrink-0 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-foreground transition hover:bg-destructive/20"
            >
              Anuluj subskrypcję
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={cancelConfirmOpen} onClose={() => setCancelConfirmOpen(false)} title="Anuluj subskrypcję" description="Ta akcja jest tylko demonstracją.">
        <div className="space-y-4">
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            To jest podgląd interfejsu — nie ma jeszcze backendu subskrypcji, więc żadna subskrypcja nie zostanie faktycznie anulowana.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCancelConfirmOpen(false)} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface">
              Wróć
            </button>
            <button
              type="button"
              disabled
              title="Funkcja demonstracyjna — anulowanie subskrypcji nie jest jeszcze aktywne"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground opacity-60"
            >
              Potwierdź anulowanie
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
