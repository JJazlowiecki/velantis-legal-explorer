import Link from "next/link";

import { ExampleQuery } from "@/components/example-query";
import { LegalSourceCard } from "@/components/legal-source-card";
import { PricingCard } from "@/components/pricing-card";
import { SearchBox } from "@/components/search-box";
import { SectionHeader } from "@/components/section-header";
import { StatusBadge } from "@/components/status-badge";

const sampleQuestions = [
  "Kiedy przedawnia się roszczenie?",
  "Odpowiedzialność za niewykonanie umowy",
  "Termin odwołania od wypowiedzenia",
  "Przesłanki zasiedzenia nieruchomości",
];

const howItWorks = [
  {
    title: "Zadajesz pytanie",
    description: "Pytasz własnymi słowami o przepis, sytuację lub problem.",
  },
  {
    title: "Velantis znajduje przepisy",
    description: "Analizujemy przepisy z oficjalnych źródeł.",
  },
  {
    title: "Otrzymujesz odpowiedź ze źródłami",
    description: "Odpowiedź jest jasna, poparta konkretnymi podstawami prawnymi.",
  },
];

const trustItems = [
  {
    title: "Oficjalne źródła",
    description: "Korzystamy z oficjalnych źródeł publikacji prawa.",
  },
  {
    title: "Widoczne podstawy prawne",
    description: "Każda odpowiedź wskazuje konkretne przepisy i akty prawne.",
  },
  {
    title: "Aktualny stan prawny",
    description: "Dane są regularnie aktualizowane wraz ze zmianami w przepisach.",
  },
  {
    title: "Jawne cytowania",
    description: "Źródła odpowiedzi są widoczne i dostępne jednym kliknięciem.",
  },
];

const targetGroups = [
  {
    title: "Studenci i aplikanci",
    description: "Nauka, przygotowanie do zajęć i szybkie odnajdywanie przepisów.",
  },
  {
    title: "Profesjonaliści",
    description: "Prawnicy, doradcy i osoby pracujące zawodowo z prawem.",
  },
  {
    title: "Firmy i organizacje",
    description: "Działy prawne, compliance, HR i administracja.",
  },
  {
    title: "Przedsiębiorcy",
    description: "Szybkie sprawdzanie przepisów potrzebnych w codziennej działalności.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 md:px-8 md:py-12">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Velantis</p>
            <p className="text-sm text-foreground">Legal Explorer</p>
          </div>
          <nav className="flex flex-wrap items-center gap-2 text-sm">
            <Link
              href="/explorer"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Otwórz aplikację
            </Link>
            <Link
              href="/login"
              className="rounded-lg border border-border px-3 py-2 text-muted-foreground transition hover:bg-hover-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Zaloguj
            </Link>
          </nav>
        </header>

        <section className="grid gap-10 py-14 md:grid-cols-[1.06fr_0.94fr] md:items-start">
          <div>
            <StatusBadge tone="muted">Źródło: ELI / Kancelaria Sejmu</StatusBadge>
            <h1 className="mt-6 max-w-xl text-5xl font-semibold leading-[1.03] tracking-tight text-foreground md:text-6xl">
              Znajdź przepis.
              <br />
              Zrozum prawo.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground">
              Zadaj pytanie normalnym językiem i otrzymaj jasną odpowiedź opartą na aktualnych przepisach oraz oficjalnych źródłach.
            </p>

            <div className="mt-8 max-w-2xl">
              <SearchBox
                placeholder="Zapytaj o przepis, zagadnienie lub problem..."
                buttonLabel="Uruchom wyszukiwanie"
              />
            </div>

            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {sampleQuestions.map((question) => (
                <ExampleQuery key={question} label={question} />
              ))}
            </div>

            <p className="mt-7 text-sm text-muted-foreground">Bezpieczne połączenie i ochrona danych użytkownika.</p>
          </div>

          <LegalSourceCard
            title="Czy można odstąpić od umowy zawartej online?"
            answer="W wielu przypadkach konsument może odstąpić od umowy zawartej na odległość w terminie 14 dni, z wyjątkami określonymi w ustawie."
            legalBases={["Ustawa o prawach konsumenta", "Kodeks cywilny"]}
            citation="art. 27"
            source="ELI / Kancelaria Sejmu"
          />
        </section>

        <section className="border-t border-border py-14">
          <SectionHeader
            eyebrow="Jak to działa"
            title="Prosty proces, konkretna odpowiedź"
            description="Bez skomplikowanych workflow. Tylko pytanie, analiza przepisów i wskazane podstawy prawne."
          />
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {howItWorks.map((step, index) => (
              <article key={step.title} className="rounded-2xl border border-border bg-surface p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">0{index + 1}</p>
                <h3 className="mt-3 text-lg font-semibold text-foreground">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="border-t border-border py-14">
          <SectionHeader eyebrow="Zaufanie" title="Dlaczego Velantis" />
          <div className="mt-8 grid gap-3 md:grid-cols-4">
            {trustItems.map((item) => (
              <article key={item.title} className="rounded-2xl border border-border bg-surface p-5">
                <h3 className="text-lg font-semibold text-foreground">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="border-t border-border py-14">
          <SectionHeader eyebrow="Dla kogo" title="Dla kogo?" />
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {targetGroups.map((group) => (
              <article key={group.title} className="rounded-2xl border border-border bg-surface p-5">
                <h3 className="text-lg font-semibold text-foreground">{group.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{group.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="pricing" className="border-t border-border py-14">
          <SectionHeader eyebrow="Plany" title="Przejrzyste ceny" />
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <PricingCard
              name="Explorer"
              price="14,99 zł"
              period="/ mies."
              features={[
                "Dostęp do bazy prawa",
                "Wyszukiwanie przepisów",
                "Odpowiedzi AI ze źródłami",
                "Podstawowe filtry",
              ]}
            />
            <PricingCard
              name="Explorer Pro"
              price="29,99 zł"
              period="/ mies."
              highlighted
              features={[
                "Wszystko z planu Explorer",
                "Większy limit analiz AI",
                "Zaawansowane filtry",
                "Historia i zapisane wyniki",
              ]}
            />
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Limity wykorzystania AI i szczegółowy zakres planów mogą ulec zmianie przed uruchomieniem usługi.
          </p>
        </section>
      </div>
    </main>
  );
}
