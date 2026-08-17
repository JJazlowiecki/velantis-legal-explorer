import { LegalPageShell } from "@/components/legal-shell/legal-page-shell";
import { getCompanyIdentity } from "@/lib/legal-shell/config";

// See LEGAL_COPY_REQUIRES_OWNER_REVIEW in src/lib/legal-shell/config.ts — draft copy, not
// yet reviewed by a lawyer or the business owner.
export default function LegalInformationPage() {
  const { companyName, contactEmail } = getCompanyIdentity();

  return (
    <LegalPageShell title="Informacje prawne" updated="wersja robocza">
      <section>
        <h2>Charakter usługi</h2>
        <p>
          Velantis Legal Explorer to narzędzie wspomagające wyszukiwanie i wstępną analizę przepisów prawa polskiego. Odpowiedzi generowane
          przez Explorer są oparte wyłącznie o zdefiniowany korpus aktów prawnych z oficjalnych źródeł (Dziennik Ustaw, ELI/api.sejm.gov.pl)
          i zawsze wskazują konkretną podstawę prawną (cytowany przepis), która je wspiera.
        </p>
        <p>
          Korpus, na którym działa Explorer, ma jednoznacznie określony zakres i datę aktualności („stan prawny na dzień&rdquo;) — akty
          prawne, których aktualność nie została jednoznacznie potwierdzona z oficjalnego źródła, są celowo wykluczone z korpusu, a nie
          domyślnie uznawane za aktualne.
        </p>
        <p>
          Status <strong>„Brak wystarczających podstaw&rdquo;</strong> (insufficient evidence) oznacza, że system świadomie odmówił
          udzielenia odpowiedzi, ponieważ nie znalazł w korpusie przepisu, który jednoznacznie wspierałby odpowiedź na zadane pytanie —
          nigdy nie jest to błąd do zignorowania, tylko celowe zabezpieczenie przed odpowiedzią bez podstawy prawnej.
        </p>
      </section>

      <section>
        <h2>Nie jest to porada prawna</h2>
        <p>
          Velantis Legal Explorer ma charakter informacyjny i wspomagający wyszukiwanie źródeł prawa. Nie stanowi porady prawnej w
          rozumieniu przepisów o świadczeniu pomocy prawnej i nie zastępuje konsultacji z adwokatem lub radcą prawnym. Odpowiedzi nie są
          gwarancją określonego wyniku sprawy ani interpretacji sądu lub organu.
        </p>
      </section>

      <section>
        <h2>Dane podmiotu</h2>
        <p>Usługodawca: {companyName}</p>
        <p>Kontakt: {contactEmail}</p>
      </section>
    </LegalPageShell>
  );
}
