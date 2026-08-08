import { ExternalLink, FileText, Scale } from "lucide-react";

interface LegalSourceCardProps {
  title: string;
  answer: string;
  legalBases: string[];
  citation: string;
  source: string;
}

export function LegalSourceCard({
  title,
  answer,
  legalBases,
  citation,
  source,
}: LegalSourceCardProps) {
  return (
    <article className="rounded-2xl border border-border bg-surface p-5 shadow-[0_24px_34px_-28px_rgba(0,0,0,0.95)]">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Odpowiedź Velantis</p>
      <h3 className="mt-2 text-lg font-semibold leading-tight text-foreground">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{answer}</p>

      <div className="mt-5 rounded-xl border border-border bg-surface-secondary p-4">
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          <Scale className="h-3.5 w-3.5" />
          Podstawy prawne
        </p>
        <ul className="mt-3 space-y-2 text-sm text-foreground">
          {legalBases.map((base) => (
            <li key={base} className="flex items-start gap-2">
              <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <span>{base}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 rounded-xl border border-border bg-surface-secondary/60 p-4">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Źródła</p>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <span>Art. 27</span>
            <span className="text-foreground">ELI / Kancelaria Sejmu</span>
          </li>
          <li className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <span>Art. 38</span>
            <span className="text-foreground">ELI / Kancelaria Sejmu</span>
          </li>
          <li className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <span>Art. 471</span>
            <span className="text-foreground">ELI / Kancelaria Sejmu</span>
          </li>
        </ul>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1">
          {citation}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1">
          Źródło: {source}
          <ExternalLink className="h-3 w-3" />
        </span>
      </div>
    </article>
  );
}
