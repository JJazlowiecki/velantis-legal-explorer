"use client";

import { cn } from "@/lib/utils";

interface SwitchToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

/** Local, unpersisted boolean toggle used across settings/account demo panels. */
export function SwitchToggle({ checked, onChange, label, description, disabled = false }: SwitchToggleProps) {
  return (
    <label
      className={cn(
        "flex items-center justify-between gap-4 py-2.5",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      )}
    >
      <span>
        <span className="block text-sm text-foreground">{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          checked ? "border-foreground/30 bg-foreground/80" : "border-border bg-surface-secondary",
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-background transition",
            checked ? "translate-x-[19px]" : "translate-x-[3px]",
          )}
        />
      </button>
    </label>
  );
}
