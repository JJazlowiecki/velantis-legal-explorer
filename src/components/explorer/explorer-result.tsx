"use client";

import { useState, useTransition } from "react";
import { Bookmark, BookmarkCheck, CircleAlert, FileText, ShieldAlert, TriangleAlert } from "lucide-react";

import {
  saveAnswerFromHistory,
  saveAnswerFromPayload,
  saveProvisionFromHistory,
  saveProvisionFromPayload,
  type SaveOutcome,
} from "@/app/explorer/saved/actions";
import type { ExplorerAnswerView, ExplorerCitedSource, ExplorerSearchResult } from "@/lib/explorer/view-model";
import { cn } from "@/lib/utils";

/** Present whenever the caller can offer real Save actions — omit entirely to render read-only (no Save UI at all). */
export interface ExplorerSaveContext {
  /** When known (the common case: the search was just recorded, or this IS a history entry), Save reads its own server-side snapshot — never re-sends answer JSON from the browser. */
  historyEntryId?: string;
  query: string;
}

interface ExplorerResultProps {
  result: ExplorerSearchResult;
  className?: string;
  saveContext?: ExplorerSaveContext;
}

type SaveButtonState = { kind: "idle" } | { kind: "pending" } | { kind: "done"; outcome: SaveOutcome };

function saveButtonLabel(state: SaveButtonState, idleLabel: string): string {
  if (state.kind === "pending") return "Zapisywanie…";
  if (state.kind === "done") {
    if (state.outcome.status === "created") return "Zapisano";
    if (state.outcome.status === "already_saved") return "Już zapisane";
    if (state.outcome.status === "quota_exceeded") return "Limit zapisanych osiągnięty";
    return "Nie udało się zapisać";
  }
  return idleLabel;
}

function SaveAnswerButton({ saveContext, data }: { saveContext: ExplorerSaveContext; data: ExplorerAnswerView }) {
  const [state, setState] = useState<SaveButtonState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (isPending || state.kind === "pending") return;
    setState({ kind: "pending" });
    startTransition(async () => {
      const outcome = saveContext.historyEntryId
        ? await saveAnswerFromHistory(saveContext.historyEntryId)
        : await saveAnswerFromPayload(saveContext.query, data);
      setState({ kind: "done", outcome });
    });
  }

  const saved = state.kind === "done" && (state.outcome.status === "created" || state.outcome.status === "already_saved");

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending || saved}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-secondary px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
    >
      {saved ? <BookmarkCheck className="h-3.5 w-3.5" aria-hidden="true" /> : <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />}
      {saveButtonLabel(state, "Zapisz odpowiedź")}
    </button>
  );
}

function SaveProvisionButton({
  saveContext,
  source,
  sourceIndex,
}: {
  saveContext: ExplorerSaveContext;
  source: ExplorerCitedSource;
  sourceIndex: number;
}) {
  const [state, setState] = useState<SaveButtonState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (isPending || state.kind === "pending") return;
    setState({ kind: "pending" });
    startTransition(async () => {
      const outcome = saveContext.historyEntryId
        ? await saveProvisionFromHistory(saveContext.historyEntryId, sourceIndex)
        : await saveProvisionFromPayload(source);
      setState({ kind: "done", outcome });
    });
  }

  const saved = state.kind === "done" && (state.outcome.status === "created" || state.outcome.status === "already_saved");

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending || saved}
      aria-label="Zapisz przepis"
      title={saveButtonLabel(state, "Zapisz przepis")}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-hover-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
    >
      {saved ? <BookmarkCheck className="h-3.5 w-3.5" aria-hidden="true" /> : <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  );
}

export function ExplorerResult({ result, className, saveContext }: ExplorerResultProps) {
  if (!result.ok) {
    return (
      <div
        role="alert"
        className={cn(
          "flex items-start gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 p-5 text-sm text-foreground",
          className,
        )}
      >
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        <div>
          <p className="font-medium">Nie udało się uzyskać odpowiedzi</p>
          <p className="mt-1 text-muted-foreground">{result.error}</p>
        </div>
      </div>
    );
  }

  const { data } = result;
  const effectiveSaveContext: ExplorerSaveContext | undefined = saveContext
    ? { historyEntryId: saveContext.historyEntryId ?? result.historyEntryId, query: saveContext.query }
    : undefined;

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <article className="rounded-2xl border border-border bg-surface p-5 shadow-[0_24px_34px_-28px_rgba(0,0,0,0.95)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {data.status === "answered" ? "Odpowiedź Velantis" : "Brak wystarczających podstaw"}
          </p>
          {effectiveSaveContext ? <SaveAnswerButton saveContext={effectiveSaveContext} data={data} /> : null}
        </div>
        <p className="mt-3 whitespace-pre-line text-sm leading-6 text-foreground">{data.answer}</p>
      </article>

      {data.citedSources.length > 0 ? (
        <div className="rounded-xl border border-border bg-surface-secondary/60 p-4">
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            Źródła
          </p>
          <ul className="mt-3 space-y-3">
            {data.citedSources.map((source, sourceIndex) => (
              <li key={`${source.actTitle}::${source.citationLabel}`} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{source.citationLabel}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{source.actTitle}</span>
                    {effectiveSaveContext ? (
                      <SaveProvisionButton saveContext={effectiveSaveContext} source={source} sourceIndex={sourceIndex} />
                    ) : null}
                  </div>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{source.text}</p>
                {source.isNonAuthoritative || source.isCurrentnessUnproven ? (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-300">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      {source.isNonAuthoritative
                        ? "Źródło nieautorytatywne — nie stanowi samodzielnie wiążącego prawa. "
                        : ""}
                      {source.isCurrentnessUnproven
                        ? "Aktualność tego przepisu nie została potwierdzona przez system."
                        : ""}
                    </span>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.uncertainties.length > 0 ? (
        <div className="rounded-xl border border-border bg-surface-secondary/60 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Niepewności</p>
          <ul className="mt-3 space-y-1.5 text-sm leading-6 text-muted-foreground">
            {data.uncertainties.map((entry, index) => (
              <li key={index}>{entry}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.alternativePaths.length > 0 ? (
        <div className="rounded-xl border border-border/80 p-4">
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
            Niepotwierdzone możliwe kierunki
          </p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
            {data.alternativePaths.map((path, index) => (
              <li key={index}>
                <span className="font-medium text-foreground">{path.issueLabel}:</span> {path.explanation}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.clarificationQuestion ? (
        <div className="rounded-xl border border-border p-4 text-sm leading-6 text-muted-foreground">
          <span className="font-medium text-foreground">Dodatkowe pytanie: </span>
          {data.clarificationQuestion}
        </div>
      ) : null}
    </div>
  );
}
