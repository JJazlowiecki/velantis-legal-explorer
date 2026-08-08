import { ArrowUpRight } from "lucide-react";

import { Input } from "@/components/ui/input";

interface SearchBoxProps {
  placeholder: string;
  buttonLabel: string;
}

export function SearchBox({ placeholder, buttonLabel }: SearchBoxProps) {
  return (
    <form className="group rounded-2xl border border-border bg-surface-elevated p-2 shadow-[0_22px_32px_-26px_rgba(0,0,0,0.95)]">
      <div className="flex items-center gap-2">
        <label htmlFor="search-input" className="sr-only">
          Wyszukaj przepis lub zagadnienie
        </label>
        <Input
          id="search-input"
          type="search"
          placeholder={placeholder}
          className="h-13 border-0 bg-transparent px-3 text-base font-medium text-foreground placeholder:text-muted-foreground focus-visible:ring-0"
        />
        <button
          type="button"
          aria-label={buttonLabel}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-secondary text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowUpRight className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}
