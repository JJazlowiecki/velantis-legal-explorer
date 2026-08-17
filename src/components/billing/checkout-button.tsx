"use client";

import { useState } from "react";

import { createCheckoutSession } from "@/lib/billing/actions";
import type { PlanId } from "@/lib/billing/plans";

export function CheckoutButton({
  planId,
  className,
  disabled,
}: {
  planId: Exclude<PlanId, "free">;
  className?: string;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setPending(true);
    const result = await createCheckoutSession(planId);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    window.location.href = result.url;
  }

  return (
    <div className="space-y-1.5">
      <button type="button" onClick={handleClick} disabled={pending || disabled} className={className}>
        {pending ? "Przekierowywanie…" : "Wybierz plan"}
      </button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
