"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { isSidebarItemActive, sidebarBottomItems, sidebarTopItems, type SidebarItem } from "./sidebar-nav";

interface AppSidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNavigate?: () => void;
  className?: string;
}

function SidebarNavItem({
  item,
  collapsed,
  selected,
  onNavigate,
}: {
  item: SidebarItem;
  collapsed: boolean;
  selected: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition",
        selected
          ? "border-border bg-surface text-foreground"
          : "border-transparent text-muted-foreground",
        "hover:border-border hover:bg-hover-surface hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        collapsed ? "justify-center px-2" : "justify-start",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed ? <span>{item.label}</span> : <span className="sr-only">{item.label}</span>}
    </Link>
  );
}

export function AppSidebar({ collapsed, onToggleCollapsed, onNavigate, className }: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-border bg-surface-secondary",
        collapsed ? "w-[84px]" : "w-[260px]",
        className,
      )}
    >
      <div className={cn("flex items-center border-b border-border px-4 py-4", collapsed ? "justify-center" : "justify-between")}>
        <Link
          href="/explorer"
          className={cn(
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md",
            collapsed ? "px-0" : "px-1",
          )}
          onClick={onNavigate}
        >
          <p className="text-[11px] uppercase tracking-[0.26em] text-muted-foreground">Velantis</p>
          {!collapsed ? <p className="text-base font-semibold tracking-tight text-foreground">Legal Explorer</p> : null}
        </Link>

        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-foreground",
            "transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            collapsed ? "hidden" : "",
          )}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      {collapsed ? (
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Expand sidebar"
          className="mx-auto mt-3 inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      ) : null}

      <nav aria-label="Primary" className="flex-1 px-3 py-4">
        <div className="space-y-1">
          {sidebarTopItems.map((item) => (
            <SidebarNavItem
              key={item.label}
              item={item}
              collapsed={collapsed}
              selected={isSidebarItemActive(pathname, item.href)}
              onNavigate={onNavigate}
            />
          ))}
        </div>

        <hr className="my-5 border-border" />

        <div className="space-y-1">
          {sidebarBottomItems.map((item) => (
            <SidebarNavItem
              key={item.label}
              item={item}
              collapsed={collapsed}
              selected={isSidebarItemActive(pathname, item.href)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </nav>
    </aside>
  );
}
