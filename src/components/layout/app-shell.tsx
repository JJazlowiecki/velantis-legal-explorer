"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { Menu, X } from "lucide-react";

import { AppSidebar } from "@/components/layout/app-sidebar";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="md:hidden border-b border-border bg-surface px-4 py-3">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
        >
          <Menu className="h-4 w-4" />
          Nawigacja
        </button>
      </div>

      <div className="hidden md:fixed md:inset-y-0 md:left-0 md:block">
        <AppSidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((prev) => !prev)} />
      </div>

      <div
        className="md:transition-[padding] md:duration-200"
        style={{
          paddingLeft: collapsed ? "84px" : "260px",
        }}
      >
        <main className="px-4 py-6 md:px-8 md:py-10">{children}</main>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div className="absolute inset-0 bg-black/65" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full w-[260px]">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
              className="absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" />
            </button>
            <AppSidebar
              collapsed={false}
              onToggleCollapsed={() => undefined}
              onNavigate={() => setMobileOpen(false)}
              className="h-full"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
