import Link from "next/link";
import { LockKeyhole, Scale, ShieldCheck } from "lucide-react";

import { Input } from "@/components/ui/input";

export default function LoginPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-10 md:px-8 md:py-16">
      <section className="overflow-hidden rounded-3xl border border-border bg-surface shadow-[0_28px_40px_-30px_rgba(0,0,0,0.95)]">
        <div className="grid min-h-[680px] md:grid-cols-2">
          <aside className="relative hidden border-r border-border bg-surface-secondary p-10 md:flex md:flex-col md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Velantis</p>
              <p className="text-base font-semibold tracking-tight text-foreground">Legal Explorer</p>
            </div>

            <div>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(255,255,255,0.06),transparent_38%),radial-gradient(circle_at_70%_80%,rgba(255,255,255,0.05),transparent_42%)]" />
              <h1 className="relative max-w-sm font-serif text-4xl leading-tight text-foreground">
                Wróć do pracy z prawem.
              </h1>
            </div>

            <ul className="relative space-y-3 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-foreground" />
                Bezpieczeństwo
              </li>
              <li className="flex items-center gap-2">
                <Scale className="h-4 w-4 text-foreground" />
                Wiarygodność
              </li>
              <li className="flex items-center gap-2">
                <LockKeyhole className="h-4 w-4 text-foreground" />
                Poufność
              </li>
            </ul>
          </aside>

          <div className="flex items-center p-6 md:p-10">
            <form className="w-full space-y-5">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Logowanie</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Zaloguj się</h2>
                <p className="mt-2 text-sm text-muted-foreground">Wejdź do Velantis Legal Explorer i kontynuuj pracę z przepisami.</p>
              </div>

              <div>
                <label htmlFor="login-email" className="mb-2 block text-sm text-muted-foreground">
                  E-mail
                </label>
                <Input id="login-email" type="email" placeholder="name@firma.pl" className="h-11 bg-surface-secondary" />
              </div>

              <div>
                <label htmlFor="login-password" className="mb-2 block text-sm text-muted-foreground">
                  Hasło
                </label>
                <Input id="login-password" type="password" placeholder="••••••••" className="h-11 bg-surface-secondary" />
              </div>

              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 rounded border border-border bg-surface-secondary" />
                  Zapamiętaj mnie
                </label>
                <Link href="/forgot-password" className="text-foreground underline underline-offset-4">
                  Nie pamiętasz hasła?
                </Link>
              </div>

              <button
                type="button"
                className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2.5 text-sm font-medium text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Zaloguj się
              </button>

              <div className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                LUB
                <span className="h-px flex-1 bg-border" />
              </div>

              <div className="grid gap-2">
                <button
                  type="button"
                  className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Kontynuuj z Google
                </button>
                <button
                  type="button"
                  className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Kontynuuj z Microsoft
                </button>
              </div>

              <p className="text-sm text-muted-foreground">
                Nie masz konta?{" "}
                <Link href="/register" className="text-foreground underline underline-offset-4">
                  Utwórz konto
                </Link>
              </p>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}
