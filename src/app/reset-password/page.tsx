import { Suspense } from "react";

import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-5 py-12">
      <AuthCard title="Ustaw nowe hasło" description="Wpisz nowe hasło do swojego konta.">
        <Suspense>
          <ResetPasswordForm />
        </Suspense>
      </AuthCard>
    </main>
  );
}
