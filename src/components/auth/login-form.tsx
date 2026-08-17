"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { Input } from "@/components/ui/input";
import { signIn } from "@/lib/auth/client";

/** Safe redirect handling: only ever a same-origin relative path — never an attacker-controlled absolute URL (no open redirect). */
function safeRedirectTarget(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/explorer";
  return raw;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = safeRedirectTarget(searchParams.get("redirect"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const { error: signInError } = await signIn.email({ email, password });
    setPending(false);
    if (signInError) {
      // Deliberately generic — never confirms whether the account/email exists.
      setError("Nieprawidłowy e-mail lub hasło.");
      return;
    }
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <form className="w-full space-y-5" onSubmit={handleSubmit}>
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Logowanie</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Zaloguj się</h2>
        <p className="mt-2 text-sm text-muted-foreground">Wejdź do Velantis Legal Explorer i kontynuuj pracę z przepisami.</p>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div>
        <label htmlFor="login-email" className="mb-2 block text-sm text-muted-foreground">
          E-mail
        </label>
        <Input
          id="login-email"
          type="email"
          required
          autoComplete="email"
          placeholder="name@firma.pl"
          className="h-11 bg-surface-secondary"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div>
        <label htmlFor="login-password" className="mb-2 block text-sm text-muted-foreground">
          Hasło
        </label>
        <Input
          id="login-password"
          type="password"
          required
          autoComplete="current-password"
          placeholder="••••••••"
          className="h-11 bg-surface-secondary"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>

      <div className="flex items-center justify-end text-sm text-muted-foreground">
        <Link href="/forgot-password" className="text-foreground underline underline-offset-4">
          Nie pamiętasz hasła?
        </Link>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2.5 text-sm font-medium text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Logowanie…" : "Zaloguj się"}
      </button>

      <p className="text-sm text-muted-foreground">
        Nie masz konta?{" "}
        <Link href="/register" className="text-foreground underline underline-offset-4">
          Utwórz konto
        </Link>
      </p>
    </form>
  );
}
