"use client";

import { useState } from "react";
import { AlertTriangle, KeyRound, Mail, ShieldCheck, User } from "lucide-react";

import { DemoNotice } from "@/components/explorer/demo-notice";
import { Modal } from "@/components/explorer/modal";
import { Panel } from "@/components/explorer/panel";
import { SectionHeader } from "@/components/section-header";
import { Input } from "@/components/ui/input";
import {
  DEMO_ACCOUNT_ACTIVITY,
  DEMO_ACCOUNT_DATA,
  DEMO_ACCOUNT_PROFILE,
  DEMO_ACCOUNT_SECURITY,
} from "@/lib/explorer/demo/account";

export function AccountPageContent() {
  const [profile, setProfile] = useState(DEMO_ACCOUNT_PROFILE);
  const [editOpen, setEditOpen] = useState(false);
  const [editDraft, setEditDraft] = useState(DEMO_ACCOUNT_PROFILE);

  const [emailOpen, setEmailOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  function saveProfile() {
    setProfile(editDraft);
    setEditOpen(false);
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <SectionHeader
        eyebrow="Velantis Legal Explorer"
        title="Konto"
        description="Zarządzaj swoimi danymi, bezpieczeństwem i aktywnością konta."
        action={<DemoNotice />}
      />

      <Panel title="Profil" action={
        <button
          type="button"
          onClick={() => {
            setEditDraft(profile);
            setEditOpen(true);
          }}
          className="rounded-lg border border-border bg-surface-secondary px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Edytuj profil
        </button>
      }>
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border bg-surface-secondary text-base font-semibold text-foreground">
            {profile.initials}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{profile.name}</p>
            <p className="truncate text-sm text-muted-foreground">{profile.email}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {profile.profession} · {profile.organization}
            </p>
          </div>
        </div>
      </Panel>

      <Panel title="Dane konta">
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Kraj</dt>
            <dd className="mt-1 text-sm text-foreground">{DEMO_ACCOUNT_DATA.country}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Preferowana jurysdykcja</dt>
            <dd className="mt-1 text-sm text-foreground">{DEMO_ACCOUNT_DATA.preferredJurisdiction}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Język interfejsu</dt>
            <dd className="mt-1 text-sm text-foreground">{DEMO_ACCOUNT_DATA.interfaceLanguage}</dd>
          </div>
        </dl>
      </Panel>

      <Panel
        title="Bezpieczeństwo"
        action={
          <button
            type="button"
            onClick={() => {
              setEmailDraft(profile.email);
              setEmailOpen(true);
            }}
            className="rounded-lg border border-border bg-surface-secondary px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Zarządzaj bezpieczeństwem
          </button>
        }
      >
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="flex items-center gap-1.5 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5" />
              Ostatnia zmiana hasła
            </dt>
            <dd className="mt-1 text-sm text-foreground">{DEMO_ACCOUNT_SECURITY.lastPasswordChange}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Weryfikacja dwuetapowa
            </dt>
            <dd className="mt-1 text-sm text-foreground">{DEMO_ACCOUNT_SECURITY.twoFactorEnabled ? "Włączona" : "Wyłączona"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Aktywne sesje</dt>
            <dd className="mt-1 text-sm text-foreground">{DEMO_ACCOUNT_SECURITY.activeSessions}</dd>
          </div>
        </dl>
      </Panel>

      <Panel title="Aktywność konta">
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Konto od</dt>
            <dd className="mt-1 text-sm text-foreground">{DEMO_ACCOUNT_ACTIVITY.memberSince}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Zapisane elementy</dt>
            <dd className="mt-1 text-sm text-foreground">{DEMO_ACCOUNT_ACTIVITY.savedItems}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Wyszukiwania w tym miesiącu</dt>
            <dd className="mt-1 text-sm text-foreground">{DEMO_ACCOUNT_ACTIVITY.searchesThisMonth}</dd>
          </div>
        </dl>
      </Panel>

      <Panel title="Strefa zagrożenia" className="border-destructive/30">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <p className="text-sm text-muted-foreground">Usunięcie konta jest nieodwracalne i wiąże się z utratą dostępu do zapisanych danych.</p>
          <button
            type="button"
            onClick={() => {
              setDeleteConfirmText("");
              setDeleteOpen(true);
            }}
            className="shrink-0 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground transition hover:bg-destructive/20"
          >
            Usuń konto
          </button>
        </div>
      </Panel>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edytuj profil">
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <User className="h-3.5 w-3.5" />
              Imię i nazwisko
            </span>
            <Input value={editDraft.name} onChange={(event) => setEditDraft((prev) => ({ ...prev, name: event.target.value }))} className="mt-2 h-10 bg-surface-secondary" />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Zawód</span>
            <Input value={editDraft.profession} onChange={(event) => setEditDraft((prev) => ({ ...prev, profession: event.target.value }))} className="mt-2 h-10 bg-surface-secondary" />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Organizacja</span>
            <Input value={editDraft.organization} onChange={(event) => setEditDraft((prev) => ({ ...prev, organization: event.target.value }))} className="mt-2 h-10 bg-surface-secondary" />
          </label>
          <p className="text-xs text-muted-foreground">Zmiany zostaną zachowane wyłącznie w tym podglądzie interfejsu i znikną po odświeżeniu strony.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditOpen(false)} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface">
              Anuluj
            </button>
            <button type="button" onClick={saveProfile} className="rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm font-medium text-foreground transition hover:bg-hover-surface">
              Zapisz zmiany
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={emailOpen} onClose={() => setEmailOpen(false)} title="Zmień adres e-mail">
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Mail className="h-3.5 w-3.5" />
              Nowy adres e-mail
            </span>
            <Input type="email" value={emailDraft} onChange={(event) => setEmailDraft(event.target.value)} className="mt-2 h-10 bg-surface-secondary" />
          </label>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            To jest podgląd interfejsu — adres e-mail konta nie zostanie faktycznie zmieniony, ponieważ ten milestone nie obejmuje uwierzytelniania.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEmailOpen(false)} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface">
              Anuluj
            </button>
            <button
              type="button"
              disabled
              title="Funkcja demonstracyjna — zmiana adresu e-mail nie jest jeszcze aktywna"
              className="rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm font-medium text-muted-foreground opacity-60"
            >
              Wyślij potwierdzenie
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Usuń konto" description="Ta czynność jest nieodwracalna.">
        <div className="space-y-4">
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            To jest podgląd interfejsu — żadne konto nie zostanie usunięte. Uwierzytelnianie i rzeczywiste zarządzanie kontem nie są jeszcze
            zaimplementowane.
          </p>
          <label className="block text-sm">
            <span className="text-muted-foreground">Wpisz &bdquo;USUŃ&rdquo;, aby potwierdzić (podgląd)</span>
            <Input value={deleteConfirmText} onChange={(event) => setDeleteConfirmText(event.target.value)} className="mt-2 h-10 bg-surface-secondary" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDeleteOpen(false)} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface">
              Anuluj
            </button>
            <button
              type="button"
              disabled
              title="Funkcja demonstracyjna — usuwanie konta nie jest jeszcze aktywne"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground opacity-60"
            >
              Usuń konto trwale
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
