import "server-only";

import { getServerEnv } from "@/lib/env/server";

/**
 * LEGAL_COPY_REQUIRES_OWNER_REVIEW — the draft copy on /terms, /privacy, /legal is
 * concise, sensible placeholder text written for this milestone. It has NOT been reviewed
 * or approved by a lawyer or the business owner and must not be treated as final before a
 * real paid beta. Company/contact identity below is read from env, never invented.
 */
export const LEGAL_COPY_REQUIRES_OWNER_REVIEW = true;

export function getCompanyIdentity() {
  const env = getServerEnv();
  return {
    companyName: env.COMPANY_NAME ?? "[nazwa podmiotu — do uzupełnienia]",
    contactEmail: env.CONTACT_EMAIL ?? "[adres kontaktowy — do uzupełnienia]",
  };
}
