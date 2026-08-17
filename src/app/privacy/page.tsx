import { LegalPageShell } from "@/components/legal-shell/legal-page-shell";
import { getCompanyIdentity } from "@/lib/legal-shell/config";

// See LEGAL_COPY_REQUIRES_OWNER_REVIEW in src/lib/legal-shell/config.ts — draft copy, not
// yet reviewed by a lawyer or the business owner. No real DPO/registration data is invented.
export default function PrivacyPage() {
  const { companyName, contactEmail } = getCompanyIdentity();

  return (
    <LegalPageShell title="Polityka prywatności" updated="wersja robocza">
      <section>
        <h2>1. Administrator danych</h2>
        <p>Administratorem danych jest: {companyName}. Kontakt w sprawach ochrony danych: {contactEmail}.</p>
      </section>

      <section>
        <h2>2. Jakie dane przetwarzamy</h2>
        <p>Adres e-mail i hasło (w postaci zahaszowanej, nigdy jawnej) — do obsługi konta i logowania.</p>
        <p>Treść zapytań wysyłanych do Explorera oraz wygenerowane odpowiedzi — do realizacji usługi, historii i zapisanych elementów.</p>
        <p>Dane rozliczeniowe przetwarzane są przez Stripe jako odrębnego administratora/procesora płatności.</p>
      </section>

      <section>
        <h2>3. Cel i podstawa przetwarzania</h2>
        <p>
          Świadczenie usługi (realizacja umowy), rozliczenia (obowiązek prawny), bezpieczeństwo konta (uzasadniony interes administratora).
        </p>
      </section>

      <section>
        <h2>4. Prawa użytkownika</h2>
        <p>
          Użytkownik ma prawo dostępu do swoich danych, ich sprostowania, usunięcia oraz przenoszenia — kontakt: {contactEmail}.
        </p>
      </section>

      <section>
        <h2>5. Odbiorcy danych</h2>
        <p>Dane mogą być przekazywane dostawcom infrastruktury technicznej (hosting, baza danych), dostawcy płatności (Stripe) oraz dostawcy poczty transakcyjnej.</p>
      </section>
    </LegalPageShell>
  );
}
