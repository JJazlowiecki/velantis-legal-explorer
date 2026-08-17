"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/lib/auth/client";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    // Deliberately anti-enumeration: this always shows the same "sent" state regardless of
    // whether the account exists or whether mail is actually configured server-side (see
    // src/lib/mail/send.ts) — never confirms account existence, never claims a fake success
    // beyond what Better Auth itself already guarantees generically.
    await requestPasswordReset({ email, redirectTo: "/reset-password" });
    setPending(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-foreground">Jeśli konto o podanym adresie e-mail istnieje, wysłaliśmy na nie link do resetu hasła.</p>
        <p className="text-sm text-muted-foreground">Sprawdź folder spam, jeśli wiadomość nie dotrze w ciągu kilku minut.</p>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div>
        <label htmlFor="forgot-email" className="mb-2 block text-sm text-muted-foreground">
          E-mail
        </label>
        <Input
          id="forgot-email"
          type="email"
          required
          autoComplete="email"
          placeholder="name@firma.pl"
          className="h-10 bg-surface-secondary"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm font-medium text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Wysyłanie…" : "Wyślij link resetu"}
      </button>
    </form>
  );
}
