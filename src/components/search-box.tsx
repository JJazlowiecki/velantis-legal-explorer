"use client";

import { ArrowUpRight, Loader2 } from "lucide-react";
import type { ChangeEvent, FormEvent } from "react";

import { Input } from "@/components/ui/input";

interface SearchBoxProps {
  placeholder: string;
  buttonLabel: string;
  /** Omit for a purely presentational, uncontrolled search box (e.g. the marketing page). */
  value?: string;
  onValueChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  disabled?: boolean;
  loading?: boolean;
}

export function SearchBox({
  placeholder,
  buttonLabel,
  value,
  onValueChange,
  onSubmit,
  disabled = false,
  loading = false,
}: SearchBoxProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Always prevent the native form submission (would otherwise reload the page) —
    // wiring is opt-in via onSubmit, but the form must never navigate regardless.
    event.preventDefault();
    if (disabled || !onSubmit) {
      return;
    }
    onSubmit(value ?? "");
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onValueChange?.(event.target.value);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="group rounded-2xl border border-border bg-surface-elevated p-2 shadow-[0_22px_32px_-26px_rgba(0,0,0,0.95)]"
    >
      <div className="flex items-center gap-2">
        <label htmlFor="search-input" className="sr-only">
          Wyszukaj przepis lub zagadnienie
        </label>
        <Input
          id="search-input"
          type="search"
          placeholder={placeholder}
          value={value}
          onChange={onValueChange ? handleChange : undefined}
          disabled={disabled}
          className="h-13 border-0 bg-transparent px-3 text-base font-medium text-foreground placeholder:text-muted-foreground focus-visible:ring-0"
        />
        <button
          type="submit"
          aria-label={buttonLabel}
          disabled={disabled}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-secondary text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowUpRight className="h-4 w-4" />}
        </button>
      </div>
    </form>
  );
}
