import { Info } from "lucide-react";

import { cn } from "@/lib/utils";

interface DemoNoticeProps {
  className?: string;
  label?: string;
}

/** Visually restrained label marking a page/section as UI-concept only, backed by static demo data. */
export function DemoNotice({ className, label = "Podgląd interfejsu — dane demonstracyjne" }: DemoNoticeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-surface-secondary px-2.5 py-1 text-[11px] text-muted-foreground",
        className,
      )}
    >
      <Info className="h-3 w-3 shrink-0" aria-hidden="true" />
      {label}
    </div>
  );
}
