import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { ExplorerResult } from "@/components/explorer/explorer-result";
import { getDb } from "@/db";
import { getHistoryEntry } from "@/lib/explorer/history/service";
import { getVisitorId } from "@/lib/explorer/history/visitor";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reopens a previously persisted /explorer answer from its stored snapshot — never re-runs
 * the legal pipeline (no new OpenAI call, no new retrieval). Visitor-scoped: a malformed id,
 * a nonexistent id, or an id owned by a different visitor all render the same 404, never
 * leaking whether a given id exists for someone else.
 */
export default async function ExplorerHistoryEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const visitorId = await getVisitorId();
  if (!visitorId) {
    notFound();
  }

  const entry = await getHistoryEntry({ db: getDb(), visitorId, id });
  if (!entry) {
    notFound();
  }

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div>
          <Link
            href="/explorer/history"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Wróć do historii
          </Link>
          <p className="mt-4 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Zapisana odpowiedź · {entry.createdAt.toLocaleString("pl-PL")}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{entry.query}</h1>
        </div>

        <ExplorerResult result={{ ok: true, data: entry.snapshot }} saveContext={{ historyEntryId: id, query: entry.query }} />
      </div>
    </AppShell>
  );
}
