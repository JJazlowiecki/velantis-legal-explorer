import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface PanelProps {
  children: ReactNode;
  className?: string;
  title?: string;
  description?: string;
  action?: ReactNode;
}

/** Shared card/panel shell reused across the sidebar pages instead of repeating the border/radius/padding recipe. */
export function Panel({ children, className, title, description, action }: PanelProps) {
  return (
    <section className={cn("rounded-2xl border border-border bg-surface p-5", className)}>
      {title ? (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {action ? <div>{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
