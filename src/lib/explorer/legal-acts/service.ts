import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema";
import { legalActResources, legalActs, legalActVersions, legalProvisions } from "../../../db/schema";
import type { CurrentnessStatus, ExpressionAuthorityClass, LegalActVersionKind } from "@/lib/legal/eli/schema";
import { chooseDisplayVersion, type VersionSelectionInput } from "./version-selection";

type Db = PostgresJsDatabase<typeof schema>;

export interface LegalActVersionSummary {
  id: string;
  versionKind: LegalActVersionKind;
  sourceExpressionId: string;
  canonicalEliUri: string | null;
  authorityClass: ExpressionAuthorityClass;
  nonAuthoritative: boolean;
  currentnessStatus: CurrentnessStatus;
  legalStateDate: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  hasStructure: boolean;
  resources: LegalActResourceSummary[];
  /**
   * Set ONLY for a real, immutable, announcement-backed consolidated (tj) version — the exact
   * official "Obwieszczenie ... jednolitego tekstu ustawy" this version's provisions came from.
   * Null for ogl/uj, and null for the legacy pre-announcement-model bare "tj" reachability alias
   * (which carries no real consolidated content) — the UI must use this field, not `hasStructure`
   * or any other proxy, to tell a real snapshot apart from that alias, since a real
   * announcement-backed version can itself legitimately have zero provisions (e.g. its HTML
   * wasn't machine-fetchable yet — see current-law-corpus spikes).
   */
  announcement: { legalActId: string; sourceId: string; title: string } | null;
}

export interface LegalActResourceSummary {
  id: string;
  representationType: string;
  fileName: string;
  sourceUrl: string;
  sourceTypeCodes: string;
}

export interface LegalActListItem {
  id: string;
  title: string;
  actType: string;
  publisher: string | null;
  journalYear: number | null;
  journalPosition: number | null;
  eliUri: string | null;
  officialPageUrl: string | null;
  versionCount: number;
  /** The version chosen by chooseDisplayVersion — null only when the act has zero versions. */
  defaultVersion: {
    id: string;
    versionKind: LegalActVersionKind;
    authorityClass: ExpressionAuthorityClass;
    nonAuthoritative: boolean;
    currentnessStatus: CurrentnessStatus;
    hasStructure: boolean;
  } | null;
}

export interface LegalActDetail {
  id: string;
  title: string;
  actType: string;
  publisher: string | null;
  journalYear: number | null;
  journalPosition: number | null;
  announcementDate: string | null;
  promulgationDate: string | null;
  entryIntoForceDate: string | null;
  eliUri: string | null;
  officialPageUrl: string | null;
  versions: LegalActVersionSummary[];
  defaultVersionId: string | null;
  authoritativeVersionId: string | null;
  retrievalVersionId: string | null;
  warnings: string[];
  /** legal_act_resources rows not associated with any known version (e.g. raw journal PDFs). */
  unresolvedResources: LegalActResourceSummary[];
}

export interface LegalActStructureNode {
  id: string;
  parentProvisionId: string | null;
  provisionType: string;
  citationLabel: string;
  heading: string | null;
  ordinal: number;
}

export interface LegalProvisionAncestor {
  id: string;
  citationLabel: string;
  heading: string | null;
}

export interface LegalProvisionDetail {
  id: string;
  legalActVersionId: string;
  provisionType: string;
  citationLabel: string;
  heading: string | null;
  text: string;
  /** Root-first (excludes the provision itself). */
  ancestors: LegalProvisionAncestor[];
}

function toResourceSummary(row: typeof legalActResources.$inferSelect): LegalActResourceSummary {
  return {
    id: row.id,
    representationType: row.representationType,
    fileName: row.fileName,
    sourceUrl: row.sourceUrl,
    sourceTypeCodes: row.sourceTypeCodes,
  };
}

/**
 * A parser content revision (see content-hash.ts / consolidated-ingest.ts) is technical
 * ingestion provenance, never a new legal promulgation — the public Legal Acts browser must
 * never show two rows for the SAME official announcement merely because it was parsed twice
 * (once with a bug, once corrected). Collapses `legal_act_versions` rows down to exactly one per
 * distinct `sourceAnnouncementLegalActId`, keeping the most recently created (i.e. current-best)
 * content revision; rows with `sourceAnnouncementLegalActId === null` (ogl/uj/legacy) are never
 * touched — they were already unique per (act, expression) before this concept existed.
 */
export function dedupeToLatestContentRevisionPerAnnouncement<
  T extends { id: string; sourceAnnouncementLegalActId: string | null; createdAt: Date },
>(versions: T[]): T[] {
  const latestByAnnouncement = new Map<string, T>();
  const result: T[] = [];

  for (const version of versions) {
    if (version.sourceAnnouncementLegalActId === null) {
      result.push(version);
      continue;
    }

    const existing = latestByAnnouncement.get(version.sourceAnnouncementLegalActId);
    if (!existing) {
      latestByAnnouncement.set(version.sourceAnnouncementLegalActId, version);
      continue;
    }
    const isNewer =
      version.createdAt.getTime() > existing.createdAt.getTime() ||
      (version.createdAt.getTime() === existing.createdAt.getTime() && version.id > existing.id);
    if (isNewer) {
      latestByAnnouncement.set(version.sourceAnnouncementLegalActId, version);
    }
  }

  return [...result, ...latestByAnnouncement.values()];
}

/** Single query, keyed by legalActVersionId — avoids one count query per version (N+1). */
async function countProvisionsByVersion(db: Db, versionIds: string[]): Promise<Map<string, number>> {
  if (versionIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({ legalActVersionId: legalProvisions.legalActVersionId, count: sql<number>`count(*)::int` })
    .from(legalProvisions)
    .where(inArray(legalProvisions.legalActVersionId, versionIds))
    .groupBy(legalProvisions.legalActVersionId);

  return new Map(rows.map((row) => [row.legalActVersionId, row.count]));
}

function toVersionSelectionInput(
  row: typeof legalActVersions.$inferSelect,
  hasStructure: boolean,
): VersionSelectionInput {
  return {
    id: row.id,
    sourceExpressionId: row.sourceExpressionId,
    versionKind: row.versionKind as LegalActVersionKind,
    canonicalEliUri: row.canonicalEliUri,
    authorityClass: row.authorityClass as ExpressionAuthorityClass,
    nonAuthoritative: row.nonAuthoritative,
    currentnessStatus: row.currentnessStatus as CurrentnessStatus,
    fetchedAt: row.fetchedAt,
    hasStructure,
    sourceAnnouncementLegalActId: row.sourceAnnouncementLegalActId,
    legalStateDate: row.legalStateDate,
  };
}

function toVersionSummary(
  row: typeof legalActVersions.$inferSelect,
  hasStructure: boolean,
  resources: LegalActResourceSummary[],
  announcement: { legalActId: string; sourceId: string; title: string } | null,
): LegalActVersionSummary {
  return {
    id: row.id,
    versionKind: row.versionKind as LegalActVersionKind,
    sourceExpressionId: row.sourceExpressionId,
    canonicalEliUri: row.canonicalEliUri,
    authorityClass: row.authorityClass as ExpressionAuthorityClass,
    nonAuthoritative: row.nonAuthoritative,
    currentnessStatus: row.currentnessStatus as CurrentnessStatus,
    legalStateDate: row.legalStateDate,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    hasStructure,
    resources,
    announcement,
  };
}

export interface ListLegalActsInput {
  db: Db;
  jurisdiction: string;
  searchTerm?: string;
  actType?: string;
  publisher?: string;
  journalYear?: number;
  authorityClass?: ExpressionAuthorityClass;
  versionKind?: LegalActVersionKind;
}

const LIST_LIMIT = 200;

/**
 * Metadata browsing only — plain deterministic SQL (ILIKE across title/source id/act type),
 * no search engine, no embeddings. Bounded to LIST_LIMIT rows; the current dataset is small,
 * but this keeps the query honest as it grows.
 */
export async function listLegalActs(input: ListLegalActsInput): Promise<LegalActListItem[]> {
  const conditions = [eq(legalActs.jurisdiction, input.jurisdiction)];

  if (input.actType) {
    conditions.push(eq(legalActs.actType, input.actType));
  }
  if (input.publisher) {
    conditions.push(eq(legalActs.publisher, input.publisher));
  }
  if (input.journalYear !== undefined) {
    conditions.push(eq(legalActs.journalYear, input.journalYear));
  }
  const term = input.searchTerm?.trim();
  if (term) {
    const pattern = `%${term}%`;
    conditions.push(
      or(ilike(legalActs.title, pattern), ilike(legalActs.sourceId, pattern), ilike(legalActs.actType, pattern))!,
    );
  }

  const acts = await input.db
    .select()
    .from(legalActs)
    .where(and(...conditions))
    .orderBy(asc(legalActs.title))
    .limit(LIST_LIMIT);

  if (acts.length === 0) {
    return [];
  }

  const actIds = acts.map((act) => act.id);
  const rawVersions = await input.db.select().from(legalActVersions).where(inArray(legalActVersions.legalActId, actIds));
  const versions = dedupeToLatestContentRevisionPerAnnouncement(rawVersions);
  const structureCounts = await countProvisionsByVersion(
    input.db,
    versions.map((v) => v.id),
  );

  const versionsByAct = new Map<string, typeof versions>();
  for (const version of versions) {
    const list = versionsByAct.get(version.legalActId) ?? [];
    list.push(version);
    versionsByAct.set(version.legalActId, list);
  }

  const items: LegalActListItem[] = acts.map((act) => {
    const actVersions = versionsByAct.get(act.id) ?? [];
    const selectionInputs = actVersions.map((v) => toVersionSelectionInput(v, (structureCounts.get(v.id) ?? 0) > 0));
    const selection = chooseDisplayVersion(selectionInputs);
    const defaultVersionRow = actVersions.find((v) => v.id === selection.defaultVersionId) ?? null;

    return {
      id: act.id,
      title: act.title,
      actType: act.actType,
      publisher: act.publisher,
      journalYear: act.journalYear,
      journalPosition: act.journalPosition,
      eliUri: act.eliUri,
      officialPageUrl: act.officialPageUrl,
      versionCount: actVersions.length,
      defaultVersion: defaultVersionRow
        ? {
            id: defaultVersionRow.id,
            versionKind: defaultVersionRow.versionKind as LegalActVersionKind,
            authorityClass: defaultVersionRow.authorityClass as ExpressionAuthorityClass,
            nonAuthoritative: defaultVersionRow.nonAuthoritative,
            currentnessStatus: defaultVersionRow.currentnessStatus as CurrentnessStatus,
            hasStructure: (structureCounts.get(defaultVersionRow.id) ?? 0) > 0,
          }
        : null,
    };
  });

  return items.filter((item) => {
    if (input.authorityClass && item.defaultVersion?.authorityClass !== input.authorityClass) {
      return false;
    }
    if (input.versionKind && item.defaultVersion?.versionKind !== input.versionKind) {
      return false;
    }
    return true;
  });
}

export interface ListLegalActFilterOptionsInput {
  db: Db;
  jurisdiction: string;
}

export interface LegalActFilterOptions {
  actTypes: string[];
  publishers: string[];
  journalYears: number[];
}

/** Populates filter dropdowns from the full (unfiltered) set for the jurisdiction — small dataset, plain distinct queries. */
export async function listLegalActFilterOptions(input: ListLegalActFilterOptionsInput): Promise<LegalActFilterOptions> {
  const rows = await input.db
    .selectDistinct({ actType: legalActs.actType, publisher: legalActs.publisher, journalYear: legalActs.journalYear })
    .from(legalActs)
    .where(eq(legalActs.jurisdiction, input.jurisdiction));

  const actTypes = [...new Set(rows.map((r) => r.actType))].sort((a, b) => a.localeCompare(b));
  const publishers = [...new Set(rows.map((r) => r.publisher).filter((p): p is string => p !== null))].sort((a, b) => a.localeCompare(b));
  const journalYears = [...new Set(rows.map((r) => r.journalYear).filter((y): y is number => y !== null))].sort((a, b) => b - a);

  return { actTypes, publishers, journalYears };
}

export interface GetLegalActInput {
  db: Db;
  id: string;
}

export async function getLegalAct(input: GetLegalActInput): Promise<LegalActDetail | null> {
  const [act] = await input.db.select().from(legalActs).where(eq(legalActs.id, input.id)).limit(1);
  if (!act) {
    return null;
  }

  const rawVersions = await input.db
    .select()
    .from(legalActVersions)
    .where(eq(legalActVersions.legalActId, input.id))
    .orderBy(asc(legalActVersions.sourceExpressionId));
  const versions = dedupeToLatestContentRevisionPerAnnouncement(rawVersions);

  const resources = await input.db.select().from(legalActResources).where(eq(legalActResources.legalActId, input.id));
  const structureCounts = await countProvisionsByVersion(
    input.db,
    versions.map((v) => v.id),
  );

  const resourcesByVersion = new Map<string, LegalActResourceSummary[]>();
  const unresolvedResources: LegalActResourceSummary[] = [];
  for (const resource of resources) {
    if (!resource.legalActVersionId) {
      unresolvedResources.push(toResourceSummary(resource));
      continue;
    }
    const list = resourcesByVersion.get(resource.legalActVersionId) ?? [];
    list.push(toResourceSummary(resource));
    resourcesByVersion.set(resource.legalActVersionId, list);
  }

  const announcementIds = [
    ...new Set(versions.map((v) => v.sourceAnnouncementLegalActId).filter((id): id is string => id !== null)),
  ];
  const announcementActs =
    announcementIds.length > 0
      ? await input.db
          .select({ id: legalActs.id, sourceId: legalActs.sourceId, title: legalActs.title })
          .from(legalActs)
          .where(inArray(legalActs.id, announcementIds))
      : [];
  const announcementById = new Map(announcementActs.map((a) => [a.id, a]));

  const selectionInputs = versions.map((v) => toVersionSelectionInput(v, (structureCounts.get(v.id) ?? 0) > 0));
  const selection = chooseDisplayVersion(selectionInputs);

  return {
    id: act.id,
    title: act.title,
    actType: act.actType,
    publisher: act.publisher,
    journalYear: act.journalYear,
    journalPosition: act.journalPosition,
    announcementDate: act.announcementDate,
    promulgationDate: act.promulgationDate,
    entryIntoForceDate: act.entryIntoForceDate,
    eliUri: act.eliUri,
    officialPageUrl: act.officialPageUrl,
    versions: versions.map((v) => {
      const announcement = v.sourceAnnouncementLegalActId
        ? (announcementById.get(v.sourceAnnouncementLegalActId) ?? null)
        : null;
      return toVersionSummary(
        v,
        (structureCounts.get(v.id) ?? 0) > 0,
        resourcesByVersion.get(v.id) ?? [],
        announcement ? { legalActId: announcement.id, sourceId: announcement.sourceId, title: announcement.title } : null,
      );
    }),
    defaultVersionId: selection.defaultVersionId,
    authoritativeVersionId: selection.authoritativeVersionId,
    retrievalVersionId: selection.retrievalVersionId,
    warnings: selection.warnings,
    unresolvedResources,
  };
}

export interface GetLegalActStructureInput {
  db: Db;
  legalActVersionId: string;
}

/**
 * Lightweight tree metadata only — never selects the `text` column, so opening a table of
 * contents for a large act (e.g. a 2,000+ provision code) never ships full provision text to
 * the browser. Returns null when the version itself doesn't exist (vs. [] for "version exists,
 * no structured provisions yet" — an honest, distinct empty state).
 */
export async function getLegalActStructure(input: GetLegalActStructureInput): Promise<LegalActStructureNode[] | null> {
  const [version] = await input.db
    .select({ id: legalActVersions.id })
    .from(legalActVersions)
    .where(eq(legalActVersions.id, input.legalActVersionId))
    .limit(1);
  if (!version) {
    return null;
  }

  const rows = await input.db
    .select({
      id: legalProvisions.id,
      parentProvisionId: legalProvisions.parentProvisionId,
      provisionType: legalProvisions.provisionType,
      citationLabel: legalProvisions.citationLabel,
      heading: legalProvisions.heading,
      ordinal: legalProvisions.ordinal,
    })
    .from(legalProvisions)
    .where(eq(legalProvisions.legalActVersionId, input.legalActVersionId))
    .orderBy(asc(legalProvisions.ordinal));

  return rows;
}

export interface GetLegalProvisionInput {
  db: Db;
  legalActVersionId: string;
  provisionId: string;
}

/**
 * The provision must belong to legalActVersionId — enforced directly in the WHERE clause (not
 * "look up by id, then check"), so a provision id from one version can never be retrieved
 * through another version's selected context.
 */
export async function getLegalProvision(input: GetLegalProvisionInput): Promise<LegalProvisionDetail | null> {
  const [row] = await input.db
    .select()
    .from(legalProvisions)
    .where(and(eq(legalProvisions.id, input.provisionId), eq(legalProvisions.legalActVersionId, input.legalActVersionId)))
    .limit(1);
  if (!row) {
    return null;
  }

  let ancestors: LegalProvisionAncestor[] = [];
  if (row.parentProvisionId) {
    const ancestorRows = (await input.db.execute(sql`
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_provision_id, heading, citation_label, 0 AS depth
        FROM legal_provisions
        WHERE id = ${row.parentProvisionId}
        UNION ALL
        SELECT lp.id, lp.parent_provision_id, lp.heading, lp.citation_label, a.depth + 1
        FROM legal_provisions lp
        INNER JOIN ancestors a ON lp.id = a.parent_provision_id
      )
      SELECT id, heading, citation_label AS "citationLabel", depth
      FROM ancestors
      ORDER BY depth DESC
    `)) as unknown as { id: string; heading: string | null; citationLabel: string; depth: number }[];
    ancestors = ancestorRows.map((a) => ({ id: a.id, citationLabel: a.citationLabel, heading: a.heading }));
  }

  return {
    id: row.id,
    legalActVersionId: row.legalActVersionId,
    provisionType: row.provisionType,
    citationLabel: row.citationLabel,
    heading: row.heading,
    text: row.text,
    ancestors,
  };
}
