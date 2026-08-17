import type { ReactNode } from "react";

/**
 * Every /explorer/* page is private, per-user, session-and-DB-backed — none of it is ever
 * meaningfully prerenderable, and prerendering would require secrets (DATABASE_URL etc.) to
 * be present at BUILD time, which this app deliberately never assumes. Setting `dynamic`
 * here applies to the whole /explorer route segment tree (Next.js route-segment-config
 * inheritance), so individual pages don't each need their own copy of this export.
 */
export const dynamic = "force-dynamic";

export default function ExplorerLayout({ children }: { children: ReactNode }) {
  return children;
}
