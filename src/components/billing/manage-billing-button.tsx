"use client";

import { useState } from "react";

import { createBillingPortalSession } from "@/lib/billing/actions";

export function ManageBillingButton({ className, disabled }: { className?: string; disabled?: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setPending(true);
    const result = await createBillingPortalSession();
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    window.location.href = result.url;
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button type="button" onClick={handleClick} disabled={disabled || pending} className={className}>
        {pending ? "Otwieranie…" : "Zarządzaj płatnościami"}
      </button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
