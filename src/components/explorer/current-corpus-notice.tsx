import { Info } from "lucide-react";

export function CurrentCorpusNotice({ effectiveAsOf }: { effectiveAsOf: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        Stan prawny korpusu: {effectiveAsOf}
        <br />
        Zakres testowy — korpus obejmuje wybrane akty prawne.
      </p>
    </div>
  );
}

export function CurrentCorpusNotReadyNotice() {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>Brak gotowego korpusu aktualnego prawa.</p>
    </div>
  );
}
