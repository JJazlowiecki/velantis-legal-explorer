import { TriangleAlert } from "lucide-react";

export function TestCorpusNotice() {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        Tryb testowy — wyszukiwanie korzysta z historycznej wersji KPA.
        <br />
        Wyniki nie przedstawiają aktualnego stanu prawnego.
      </p>
    </div>
  );
}
