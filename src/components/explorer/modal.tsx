"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  widthClassName?: string;
}

/**
 * Small local modal used for every demo dialog in the sidebar pages (details, confirmations,
 * "edit" forms, etc). Purely a client-side UI affordance — closing/opening never touches a
 * database, and nothing rendered inside claims to persist beyond this browser session unless
 * a page explicitly says otherwise.
 */
export function Modal({ open, onClose, title, description, children, widthClassName }: ModalProps) {
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="absolute inset-0 bg-black/65" onClick={onClose} />
      <div className="relative flex h-full items-center justify-center p-4">
        <div
          className={cn(
            "relative w-full max-w-md rounded-2xl border border-border bg-surface-elevated p-6 shadow-[0_28px_40px_-30px_rgba(0,0,0,0.95)]",
            widthClassName,
          )}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij"
            className="absolute right-4 top-4 inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground transition hover:bg-hover-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" />
          </button>

          <h2 id="modal-title" className="pr-8 text-lg font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          {description ? <p className="mt-1.5 text-sm text-muted-foreground">{description}</p> : null}

          <div className="mt-5">{children}</div>
        </div>
      </div>
    </div>
  );
}
