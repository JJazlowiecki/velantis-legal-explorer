"use server";

import { getDb } from "@/db";
import {
  getLegalAct,
  getLegalActStructure,
  getLegalProvision,
  listLegalActFilterOptions,
  listLegalActs,
  type LegalActDetail,
  type LegalActFilterOptions,
  type LegalActListItem,
  type LegalActStructureNode,
  type LegalProvisionDetail,
} from "@/lib/explorer/legal-acts/service";
import type { ExpressionAuthorityClass, LegalActVersionKind } from "@/lib/legal/eli/schema";

export interface LegalActSearchFilters {
  jurisdiction: string;
  searchTerm?: string;
  actType?: string;
  publisher?: string;
  journalYear?: number;
  authorityClass?: ExpressionAuthorityClass;
  versionKind?: LegalActVersionKind;
}

/**
 * Public metadata browsing — no visitor identity required (unlike History/Saved). Plain
 * deterministic SQL only; see src/lib/explorer/legal-acts/service.ts.
 */
export async function searchLegalActs(filters: LegalActSearchFilters): Promise<LegalActListItem[]> {
  return listLegalActs({ db: getDb(), ...filters });
}

export async function getLegalActFilterOptions(jurisdiction: string): Promise<LegalActFilterOptions> {
  return listLegalActFilterOptions({ db: getDb(), jurisdiction });
}

export async function getLegalActDetail(actId: string): Promise<LegalActDetail | null> {
  return getLegalAct({ db: getDb(), id: actId });
}

/** Lightweight table-of-contents metadata only — never full provision text (see the milestone's large-act performance requirement). */
export async function getLegalActStructureAction(legalActVersionId: string): Promise<LegalActStructureNode[] | null> {
  return getLegalActStructure({ db: getDb(), legalActVersionId });
}

/** Full text for exactly one provision, fetched only when the user opens it — never bundled with the table of contents. */
export async function getLegalProvisionAction(legalActVersionId: string, provisionId: string): Promise<LegalProvisionDetail | null> {
  return getLegalProvision({ db: getDb(), legalActVersionId, provisionId });
}
