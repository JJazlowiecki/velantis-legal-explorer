import Link from "next/link";
import type { ReactNode } from "react";

export function LegalPageShell({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-5 py-12 md:px-8 md:py-16">
      <Link href="/" className="text-sm text-muted-foreground underline underline-offset-4">
        ← Powrót do strony głównej
      </Link>
      <h1 className="mt-6 font-serif text-3xl font-semibold tracking-tight text-foreground md:text-4xl">{title}</h1>
      <p className="mt-2 text-xs text-muted-foreground">Ostatnia aktualizacja: {updated}</p>
      <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted-foreground [&_h2]:mb-2 [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_p]:mb-3">
        {children}
      </div>
    </main>
  );
}
