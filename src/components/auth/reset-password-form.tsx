"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { Input } from "@/components/ui/input";
import { resetPassword } from "@/lib/auth/client";

const MIN_PASSWORD_LENGTH = 8;

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">Link resetu hasła jest nieprawidłowy lub wygasł.</p>
        <Link href="/forgot-password" className="text-sm text-foreground underline underline-offset-4">
          Wyślij nowy link
        </Link>
      </div>
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków.`);
      return;
    }

    setPending(true);
    const { error: resetError } = await resetPassword({ newPassword: password, token: token! });
    setPending(false);

    if (resetError) {
      setError("Link resetu hasła jest nieprawidłowy lub wygasł. Wyślij nowy.");
      return;
    }

    setDone(true);
    setTimeout(() => {
      router.push("/login");
    }, 1500);
  }

  if (done) {
    return <p className="text-sm text-foreground">Hasło zostało zmienione. Za chwilę przekierujemy Cię do logowania.</p>;
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div>
        <label htmlFor="reset-password" className="mb-2 block text-sm text-muted-foreground">
          Nowe hasło
        </label>
        <Input
          id="reset-password"
          type="password"
          required
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          className="h-10 bg-surface-secondary"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm font-medium text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Zapisywanie…" : "Ustaw nowe hasło"}
      </button>
    </form>
  );
}
