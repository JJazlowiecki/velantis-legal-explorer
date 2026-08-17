"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Input } from "@/components/ui/input";
import { signUp } from "@/lib/auth/client";

const MIN_PASSWORD_LENGTH = 8;

export function RegisterForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"verify" | "signed_in" | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków.`);
      return;
    }

    setPending(true);
    const { data, error: signUpError } = await signUp.email({ name: name.trim() || email.split("@")[0], email, password });
    setPending(false);

    if (signUpError) {
      // Better Auth's email/password sign-up already responds generically for a duplicate
      // account (no account-existence leak) — surface its message as-is if present.
      setError(signUpError.message ?? "Nie udało się utworzyć konta.");
      return;
    }

    if (data?.user && !data.user.emailVerified) {
      setDone("verify");
      return;
    }

    setDone("signed_in");
    router.push("/explorer");
    router.refresh();
  }

  if (done === "verify") {
    return (
      <div className="space-y-3">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Sprawdź swoją skrzynkę e-mail</h2>
        <p className="text-sm text-muted-foreground">
          Konto zostało utworzone. Jeśli wysyłka wiadomości e-mail jest skonfigurowana, otrzymasz link potwierdzający na podany adres.
        </p>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div>
        <label htmlFor="register-name" className="mb-2 block text-sm text-muted-foreground">
          Imię i nazwisko
        </label>
        <Input id="register-name" type="text" autoComplete="name" className="h-10 bg-surface" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div>
        <label htmlFor="register-email" className="mb-2 block text-sm text-muted-foreground">
          E-mail
        </label>
        <Input
          id="register-email"
          type="email"
          required
          autoComplete="email"
          className="h-10 bg-surface"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div>
        <label htmlFor="register-password" className="mb-2 block text-sm text-muted-foreground">
          Hasło
        </label>
        <Input
          id="register-password"
          type="password"
          required
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          className="h-10 bg-surface"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <p className="mt-1.5 text-xs text-muted-foreground">Minimum {MIN_PASSWORD_LENGTH} znaków.</p>
      </div>

      <p className="text-xs text-muted-foreground">
        Zakładając konto, akceptujesz{" "}
        <Link href="/terms" className="underline underline-offset-4">
          regulamin
        </Link>{" "}
        i{" "}
        <Link href="/privacy" className="underline underline-offset-4">
          politykę prywatności
        </Link>
        .
      </p>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Tworzenie konta…" : "Załóż konto"}
      </button>
    </form>
  );
}
