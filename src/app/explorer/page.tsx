import { AppShell } from "@/components/layout/app-shell";
import { ExampleQuery } from "@/components/example-query";
import { ExplorerSearchPanel } from "@/components/explorer/explorer-search-panel";
import { TestCorpusNotice } from "@/components/explorer/test-corpus-notice";
import { resolveInitialQuery } from "@/lib/explorer/continue-search";

const exampleQuestions = [
  "Kiedy przedawnia się roszczenie?",
  "Odpowiedzialność za niewykonanie umowy",
  "Termin odwołania od wypowiedzenia",
  "Przesłanki zasiedzenia nieruchomości",
];

const legalAreas = [
  "Prawo cywilne",
  "Prawo karne",
  "Prawo administracyjne",
  "Prawo pracy",
  "Prawo UE",
];

interface ExplorerPageProps {
  searchParams: Promise<{ q?: string | string[] }>;
}

export default async function ExplorerPage({ searchParams }: ExplorerPageProps) {
  const params = await searchParams;
  const initialQuery = resolveInitialQuery(params);

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-[900px] flex-col items-center pt-8 md:pt-16">
        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Velantis Legal Explorer</p>
        <h1 className="mt-4 text-center text-5xl font-semibold tracking-tight text-foreground md:text-6xl">
          Czego szukasz?
        </h1>

        <div className="mt-6 w-full max-w-3xl">
          <TestCorpusNotice />
        </div>

        <div className="mt-6 w-full max-w-3xl">
          <ExplorerSearchPanel initialQuery={initialQuery} />
        </div>

        <div className="mt-8 grid w-full max-w-3xl gap-3 md:grid-cols-2">
          {exampleQuestions.map((question) => (
            <ExampleQuery key={question} label={question} />
          ))}
        </div>

        <section className="mt-14 w-full max-w-3xl border-t border-border/80 pt-8">
          <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Przeglądaj obszary prawa
          </h2>
          <div className="mt-4 flex flex-wrap items-center gap-y-3 text-sm">
            {legalAreas.map((area, index) => (
              <div key={area} className="flex items-center">
                <button
                  type="button"
                  className="px-1 text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {area}
                </button>
                {index < legalAreas.length - 1 ? (
                  <span className="mx-2 h-3 border-r border-border" aria-hidden="true" />
                ) : null}
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
