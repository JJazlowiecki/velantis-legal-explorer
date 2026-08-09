"use client";

import { useState, useTransition } from "react";

import { submitExplorerQuery } from "@/app/explorer/actions";
import { ExplorerResult } from "@/components/explorer/explorer-result";
import { SearchBox } from "@/components/search-box";
import type { ExplorerSearchResult } from "@/lib/explorer/view-model";

type ExplorerUiState = { kind: "idle" } | { kind: "result"; result: ExplorerSearchResult; submittedQuery: string };

interface ExplorerSearchPanelProps {
  /** Prefilled from ?q= when arriving via "Kontynuuj wyszukiwanie" on /explorer/history — otherwise empty, and /explorer works exactly as before. */
  initialQuery?: string;
}

export function ExplorerSearchPanel({ initialQuery = "" }: ExplorerSearchPanelProps) {
  const [query, setQuery] = useState(initialQuery);
  const [state, setState] = useState<ExplorerUiState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  function handleSubmit(value: string) {
    if (isPending) {
      // Disallow duplicate/overlapping submissions while one is already in flight.
      return;
    }

    startTransition(async () => {
      const result = await submitExplorerQuery(value);
      setState({ kind: "result", result, submittedQuery: value });
    });
  }

  return (
    <div className="w-full">
      <SearchBox
        placeholder="Zapytaj o przepis, zagadnienie lub problem..."
        buttonLabel="Uruchom wyszukiwanie"
        value={query}
        onValueChange={setQuery}
        onSubmit={handleSubmit}
        disabled={isPending}
        loading={isPending}
      />

      {state.kind === "result" ? (
        <ExplorerResult className="mt-8" result={state.result} saveContext={{ query: state.submittedQuery }} />
      ) : null}
    </div>
  );
}
