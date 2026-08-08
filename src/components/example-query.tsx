interface ExampleQueryProps {
  label: string;
}

export function ExampleQuery({ label }: ExampleQueryProps) {
  return (
    <button
      type="button"
      className="rounded-xl border border-border bg-surface px-4 py-3 text-left text-sm text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Przykładowe pytanie: ${label}`}
    >
      {label}
    </button>
  );
}
