interface StatusBadgeProps {
  children: string;
  tone?: "neutral" | "success" | "muted";
}

const toneClassName: Record<NonNullable<StatusBadgeProps["tone"]>, string> = {
  neutral: "border-border bg-surface-secondary text-foreground",
  success: "border-success/40 bg-success/15 text-foreground",
  muted: "border-border/80 bg-transparent text-muted-foreground",
};

export function StatusBadge({ children, tone = "neutral" }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide ${toneClassName[tone]}`}
    >
      {children}
    </span>
  );
}
