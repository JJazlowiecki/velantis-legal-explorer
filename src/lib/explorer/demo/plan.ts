/** Static demo billing/plan data. No Stripe, no payment backend — nothing here is real. */
export const DEMO_CURRENT_PLAN = {
  name: "Explorer Pro",
  price: "29,99 zł",
  period: "/ miesiąc",
  status: "Aktywny" as const,
  nextBillingDate: "2026-02-01",
  renewalInfo: "Subskrypcja odnawia się automatycznie, chyba że zostanie anulowana przed datą rozliczenia.",
};

export interface DemoUsageMetric {
  id: string;
  label: string;
  used: number;
  limit: number | null;
  unit: string;
}

export const DEMO_USAGE_METRICS: DemoUsageMetric[] = [
  { id: "ai-answers", label: "Odpowiedzi AI", used: 142, limit: null, unit: "w tym miesiącu" },
  { id: "saved-searches", label: "Zapisane wyszukiwania", used: 8, limit: 100, unit: "wykorzystane" },
  { id: "law-alerts", label: "Alerty zmian w prawie", used: 3, limit: 20, unit: "aktywne" },
  { id: "exports", label: "Eksporty", used: 5, limit: 50, unit: "w tym miesiącu" },
];

export interface DemoPlanOption {
  id: string;
  name: string;
  price: string;
  period: string;
  features: string[];
  current: boolean;
}

export const DEMO_PLAN_OPTIONS: DemoPlanOption[] = [
  {
    id: "explorer",
    name: "Explorer",
    price: "14,99 zł",
    period: "/ mies.",
    features: ["Dostęp do bazy prawa", "Wyszukiwanie przepisów", "Odpowiedzi AI ze źródłami", "Podstawowe filtry"],
    current: false,
  },
  {
    id: "explorer-pro",
    name: "Explorer Pro",
    price: "29,99 zł",
    period: "/ mies.",
    features: ["Wszystko z planu Explorer", "Większy limit analiz AI", "Zaawansowane filtry", "Historia i zapisane wyniki"],
    current: true,
  },
];

export const DEMO_PAYMENT_METHOD = {
  brand: "Visa",
  maskedNumber: "•••• •••• •••• 4242 (dane demonstracyjne)",
  expiry: "12/2028",
};

export const DEMO_BILLING_DETAILS = {
  name: "Kowalska i Wspólnicy Sp. k.",
  nip: "000-000-00-00 (przykładowy NIP)",
  address: "ul. Przykładowa 1, 00-000 Warszawa",
};

export interface DemoInvoice {
  id: string;
  date: string;
  amount: string;
  status: "Opłacona" | "Oczekująca";
}

export const DEMO_INVOICES: DemoInvoice[] = [
  { id: "INV-2026-0001", date: "2026-01-01", amount: "29,99 zł", status: "Opłacona" },
  { id: "INV-2025-0012", date: "2025-12-01", amount: "29,99 zł", status: "Opłacona" },
  { id: "INV-2025-0011", date: "2025-11-01", amount: "29,99 zł", status: "Opłacona" },
];
