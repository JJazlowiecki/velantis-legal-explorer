import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { Input } from "@/components/ui/input";

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-5 py-12">
      <AuthCard
        title="Reset hasła"
        description="Podaj adres e-mail. Wysyłka wiadomości zostanie dodana w kolejnych etapach."
        footer={
          <p>
            Pamiętasz hasło?{" "}
            <Link href="/login" className="text-foreground underline underline-offset-4">
              Wróć do logowania
            </Link>
          </p>
        }
      >
        <div>
          <label htmlFor="forgot-email" className="mb-2 block text-sm text-muted-foreground">
            E-mail
          </label>
          <Input id="forgot-email" type="email" placeholder="name@firma.pl" className="h-10 bg-surface-secondary" />
        </div>

        <button
          type="button"
          className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm font-medium text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Wyślij link resetu
        </button>
      </AuthCard>
    </main>
  );
}
