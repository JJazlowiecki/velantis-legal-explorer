import {
  Bookmark,
  CreditCard,
  FileSearch,
  History,
  Plus,
  Settings,
  UserCircle2,
  type LucideIcon,
} from "lucide-react";

export interface SidebarItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const sidebarTopItems: SidebarItem[] = [
  { label: "Nowe wyszukiwanie", href: "/explorer", icon: Plus },
  { label: "Historia", href: "/explorer/history", icon: History },
  { label: "Zapisane", href: "/explorer/saved", icon: Bookmark },
  { label: "Akty prawne", href: "/explorer/legal-acts", icon: FileSearch },
];

export const sidebarBottomItems: SidebarItem[] = [
  { label: "Konto", href: "/explorer/account", icon: UserCircle2 },
  { label: "Plan", href: "/explorer/plan", icon: CreditCard },
  { label: "Ustawienia", href: "/explorer/settings", icon: Settings },
];

/** A sidebar item is active only on an exact route match — these are flat, sibling routes. */
export function isSidebarItemActive(pathname: string, href: string): boolean {
  return pathname === href;
}
