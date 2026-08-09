import type { CurrentnessStatus, ExpressionAuthorityClass, LegalActVersionKind } from "@/lib/legal/eli/schema";

/**
 * Wording deliberately mirrors src/components/explorer/explorer-result.tsx's cited-source
 * warnings, so the same act/version never reads as "safe" in one place and "risky" in
 * another. Never claim "Obowiązujący"/"Aktualny" — see milestone spec section 2.
 */
export const VERSION_KIND_LABELS: Record<LegalActVersionKind, string> = {
  promulgated: "Tekst pierwotny (ogłoszenie)",
  consolidated: "Tekst jednolity (urzędowy)",
  unified: "Tekst ujednolicony",
  unknown: "Nieznany rodzaj tekstu",
};

export const AUTHORITY_CLASS_LABELS: Record<ExpressionAuthorityClass, string> = {
  authoritative: "Tekst autorytatywny",
  non_authoritative: "Tekst nieautorytatywny",
  unknown: "Autorytatywność nieznana",
};

export const CURRENTNESS_STATUS_LABELS: Record<CurrentnessStatus, string> = {
  proven_current: "Potwierdzona aktualność",
  unproven: "Aktualność niepotwierdzona",
};

export function nonAuthoritativeWarning(): string {
  return "Źródło nieautorytatywne — nie stanowi samodzielnie wiążącego prawa.";
}

export function currentnessUnprovenWarning(): string {
  return "Aktualność tego przepisu nie została potwierdzona przez system.";
}

export function historicalPromulgatedNote(): string {
  return "To pierwotny (promulgowany) tekst ogłoszenia — może nie odzwierciedlać obecnie obowiązującego stanu prawnego.";
}
