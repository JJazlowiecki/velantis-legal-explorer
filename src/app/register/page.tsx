import { AuthCard } from "@/components/auth/auth-card";
import { Input } from "@/components/ui/input";

const steps = ["Konto", "Plan", "Gotowe"];

export default function RegisterPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-5 py-12">
      <AuthCard title="Załóż konto" description="Wizualny szkic procesu rejestracji. Logika backendowa zostanie dodana w kolejnych etapach.">
        <ol className="grid gap-2 rounded-xl border border-border bg-surface-secondary p-3 text-sm sm:grid-cols-3">
          {steps.map((step, index) => (
            <li
              key={step}
              className={`rounded-md border px-3 py-2 ${
                index === 0 ? "border-foreground/30 bg-surface text-foreground" : "border-border text-muted-foreground"
              }`}
            >
              {index + 1}. {step}
            </li>
          ))}
        </ol>

        <section className="rounded-xl border border-border bg-surface-secondary p-4">
          <h2 className="text-base font-medium text-foreground">1. Dane konta</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="first-name" className="mb-2 block text-sm text-muted-foreground">
                Imię
              </label>
              <Input id="first-name" type="text" className="h-10 bg-surface" />
            </div>
            <div>
              <label htmlFor="last-name" className="mb-2 block text-sm text-muted-foreground">
                Nazwisko
              </label>
              <Input id="last-name" type="text" className="h-10 bg-surface" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="register-email" className="mb-2 block text-sm text-muted-foreground">
                E-mail
              </label>
              <Input id="register-email" type="email" className="h-10 bg-surface" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="register-password" className="mb-2 block text-sm text-muted-foreground">
                Hasło
              </label>
              <Input id="register-password" type="password" className="h-10 bg-surface" />
            </div>
          </div>
          <label className="mt-4 inline-flex items-start gap-2 text-sm text-muted-foreground">
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border border-border bg-surface" />
            Akceptuję regulamin i politykę prywatności.
          </label>
        </section>

        <section className="rounded-xl border border-border bg-surface-secondary p-4">
          <h2 className="text-base font-medium text-foreground">2. Wybór planu</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-foreground/30 bg-surface p-3">
              <p className="text-sm font-medium text-foreground">Explorer</p>
              <p className="mt-1 text-sm text-muted-foreground">14,99 zł / mies.</p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-sm font-medium text-foreground">Explorer Pro</p>
              <p className="mt-1 text-sm text-muted-foreground">29,99 zł / mies.</p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-surface-secondary p-4">
          <h2 className="text-base font-medium text-foreground">3. Gotowe</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Konto i płatności zostaną aktywowane po wdrożeniu funkcjonalności backendowej.
          </p>
        </section>

        <button
          type="button"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Załóż konto
        </button>
      </AuthCard>
    </main>
  );
}
