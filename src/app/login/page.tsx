import { Suspense } from "react";
import { LockKeyhole, Scale, ShieldCheck } from "lucide-react";

import { LoginForm } from "@/components/auth/login-form";

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
            <Suspense>
              <LoginForm />
            </Suspense>
          </div>
        </div>
      </section>
    </main>
  );
}
