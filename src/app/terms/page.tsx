import { LegalPageShell } from "@/components/legal-shell/legal-page-shell";
import { getCompanyIdentity } from "@/lib/legal-shell/config";

// See LEGAL_COPY_REQUIRES_OWNER_REVIEW in src/lib/legal-shell/config.ts — draft copy, not
// yet reviewed by a lawyer or the business owner.
export default function TermsPage() {
  const { companyName, contactEmail } = getCompanyIdentity();

  return (
    <LegalPageShell title="Regulamin" updated="wersja robocza">
      <section>
        <h2>1. Przedmiot usługi</h2>
        <p>
          Velantis Legal Explorer („Usługa&rdquo;) udostępnia narzędzie do wyszukiwania i wstępnej analizy przepisów prawa polskiego w
          oparciu o zdefiniowany, jawnie ograniczony korpus aktów prawnych z oficjalnych źródeł. Usługa nie stanowi porady prawnej — patrz
          strona /legal.
        </p>
      </section>

      <section>
        <h2>2. Konto i rejestracja</h2>
        <p>Korzystanie z Explorera wymaga założenia konta (e-mail i hasło). Użytkownik odpowiada za poufność danych logowania.</p>
      </section>

      <section>
        <h2>3. Plany i limity</h2>
        <p>
          Usługa jest dostępna w planie bezpłatnym (FREE) oraz planach płatnych (BASIC, PLUS), różniących się miesięcznym limitem zapytań.
          Limit odnawia się na początku każdego miesiąca kalendarzowego. Szczegóły planów dostępne są na stronie /explorer/plan.
        </p>
      </section>

      <section>
        <h2>4. Płatności</h2>
        <p>
          Płatności obsługiwane są przez Stripe. Subskrypcja odnawia się automatycznie do momentu anulowania przez użytkownika w panelu
          zarządzania płatnościami (Stripe Customer Portal).
        </p>
      </section>

      <section>
        <h2>5. Ograniczenie odpowiedzialności</h2>
        <p>
          Usługodawca dokłada starań, aby odpowiedzi Explorera były poparte wyłącznie treścią wskazanych źródeł, jednak nie gwarantuje
          kompletności ani bezbłędności odpowiedzi. Usługa nie zastępuje porady prawnej.
        </p>
      </section>

      <section>
        <h2>6. Kontakt</h2>
        <p>Usługodawca: {companyName}</p>
        <p>Kontakt: {contactEmail}</p>
      </section>
    </LegalPageShell>
  );
}
