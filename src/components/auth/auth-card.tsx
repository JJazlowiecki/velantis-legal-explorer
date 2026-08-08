import type { ReactNode } from "react";

interface AuthCardProps {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <section className="w-full rounded-2xl border border-border bg-surface p-6 shadow-[0_22px_35px_-30px_rgba(0,0,0,0.95)] md:p-8">
      <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <div className="mt-6 space-y-4">{children}</div>
      {footer ? <div className="mt-6 border-t border-border pt-5 text-sm text-muted-foreground">{footer}</div> : null}
    </section>
  );
}
