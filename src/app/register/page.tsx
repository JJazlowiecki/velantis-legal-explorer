import { AuthCard } from "@/components/auth/auth-card";
import { RegisterForm } from "@/components/auth/register-form";

export default function RegisterPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-5 py-12">
      <AuthCard title="Załóż konto" description="Zacznij od bezpłatnego planu FREE — możesz przejść na plan płatny w każdej chwili.">
        <RegisterForm />
      </AuthCard>
    </main>
  );
}
