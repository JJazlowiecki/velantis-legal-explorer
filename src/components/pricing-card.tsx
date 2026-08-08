import { Check } from "lucide-react";

interface PricingCardProps {
  name: string;
  price: string;
  period: string;
  features: string[];
  highlighted?: boolean;
}

export function PricingCard({ name, price, period, features, highlighted = false }: PricingCardProps) {
  return (
    <article
      className={`rounded-2xl border p-6 ${
        highlighted
          ? "border-foreground/25 bg-surface-elevated shadow-[0_24px_35px_-28px_rgba(0,0,0,0.95)]"
          : "border-border bg-surface"
      }`}
    >
      <h3 className="text-lg font-semibold text-foreground">{name}</h3>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">{price}</p>
      <p className="mt-1 text-sm text-muted-foreground">{period}</p>
      <ul className="mt-6 space-y-3">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-muted-foreground">
            <Check className="mt-0.5 h-4 w-4 text-foreground" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled
        className="mt-6 inline-flex w-full items-center justify-center rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm font-medium text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-80"
      >
        Wybierz plan
      </button>
    </article>
  );
}
