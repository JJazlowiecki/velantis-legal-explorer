"use client";

import { cn } from "@/lib/utils";

interface FormSelectOption {
  value: string;
  label: string;
}

interface FormSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: FormSelectOption[];
  description?: string;
  className?: string;
}

/** Labeled native <select>, styled to match the Input primitive used elsewhere in the app. */
export function FormSelect({ label, value, onChange, options, description, className }: FormSelectProps) {
  return (
    <label className={cn("block", className)}>
      <span className="block text-sm text-foreground">{label}</span>
      {description ? <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span> : null}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-9 w-full rounded-lg border border-input bg-surface-secondary px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
