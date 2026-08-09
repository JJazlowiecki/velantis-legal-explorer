"use client";

import { cn } from "@/lib/utils";

export interface TabGroupOption<T extends string> {
  value: T;
  label: string;
}

interface TabGroupProps<T extends string> {
  options: TabGroupOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** Local, unpersisted tab switcher — purely client-side UI state. */
export function TabGroup<T extends string>({ options, value, onChange, className }: TabGroupProps<T>) {
  return (
    <div role="tablist" className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "border-border bg-surface text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:bg-hover-surface hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
