import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-5 py-12">
      <AuthCard
        title="Reset hasła"
        description="Podaj adres e-mail powiązany z kontem, aby otrzymać link do ustawienia nowego hasła."
        footer={
          <p>
            Pamiętasz hasło?{" "}
            <Link href="/login" className="text-foreground underline underline-offset-4">
              Wróć do logowania
            </Link>
          </p>
        }
      >
        <ForgotPasswordForm />
      </AuthCard>
    </main>
  );
}
