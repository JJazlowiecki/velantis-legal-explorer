import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema";
import { legalActVersions, legalActs } from "../../../db/schema";
import { fetchEliActMetadata, fetchEliActReferences } from "./client";
import { computeParsedContentHash } from "./content-hash";
import { mapEliMetadataToLegalAct } from "./ingest";
import { replaceProvisionsForVersion, StructureIngestError } from "./structure-ingest";
import { parseActStructureHtml } from "./structure";
import { ELI_SOURCE, type EliActMetadata } from "./schema";

export class ConsolidatedIngestError extends StructureIngestError {}

type Db = PostgresJsDatabase<typeof schema>;

export interface IngestOfficialConsolidatedStructureInput {
  db: Db;
  /** e.g. "DU/1964/93" — the base statute (KC, KPA, ...). Must already exist in legal_acts. */
  baseActSourceId: string;
  /** e.g. "DU/2024/1061" — the official "Obwieszczenie ... jednolitego tekstu ustawy" act. */
  announcementActSourceId: string;
  allowDestructiveShrink?: boolean;
  fetchMetadata?: typeof fetchEliActMetadata;
  fetchReferences?: typeof fetchEliActReferences;
  fetchHtml?: (input: { publisher: string; year: number; position: number }) => Promise<string>;
}

export interface IngestOfficialConsolidatedStructureResult {
  baseLegalActId: string;
  announcementLegalActId: string;
  legalActVersionId: string;
  versionAction: "inserted" | "reused";
  deletedCount: number;
  insertedCount: number;
}

function parseSourceId(sourceId: string): { publisher: string; year: number; position: number } {
  const [publisher, yearStr, positionStr] = sourceId.split("/");
  const year = Number(yearStr);
  const position = Number(positionStr);
  if (!publisher || !Number.isInteger(year) || !Number.isInteger(position)) {
    throw new ConsolidatedIngestError(`Malformed sourceId "${sourceId}" — expected "PUBLISHER/YEAR/POSITION"`);
  }
  return { publisher, year, position };
}

function defaultFetchHtml(): (input: { publisher: string; year: number; position: number }) => Promise<string> {
  return async ({ publisher, year, position }) => {
    const url = `https://api.sejm.gov.pl/eli/acts/${publisher}/${year}/${position}/text.html`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Velantis-Legal-Explorer/0.1 (+https://velantis.local)" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new ConsolidatedIngestError(`Failed to fetch announcement text: HTTP ${response.status}`);
    }
    return response.text();
  };
}

/** True if `references[relationLabel]` contains an entry whose act resolves to `targetSourceId`. */
function referencesContain(
  references: Awaited<ReturnType<typeof fetchEliActReferences>>,
  relationLabel: string,
  targetSourceId: string,
): boolean {
  const entries = references[relationLabel] ?? [];
  return entries.some((entry) => `${entry.act.publisher}/${entry.act.year}/${entry.act.pos}` === targetSourceId);
}

async function findOrInsertLegalAct(db: Db, metadata: EliActMetadata): Promise<{ id: string; sourceId: string }> {
  const actData = mapEliMetadataToLegalAct(metadata);

  const [existing] = await db
    .select({ id: legalActs.id, sourceId: legalActs.sourceId })
    .from(legalActs)
    .where(and(eq(legalActs.source, ELI_SOURCE), eq(legalActs.sourceId, actData.sourceId)))
    .limit(1);

  if (existing) {
    return existing;
  }

  const [inserted] = await db.insert(legalActs).values(actData).returning({ id: legalActs.id, sourceId: legalActs.sourceId });
  return inserted;
}

/**
 * Ingests ONE immutable, announcement-backed, content-addressed consolidated (tj) revision of a
 * base statute.
 *
 * This is the ONLY place a `legal_act_versions` row with `sourceAnnouncementLegalActId` set is
 * ever created. A version's real identity is the TRIPLE (baseActId, announcementActId,
 * contentHash) — see content-hash.ts: re-running with the SAME announcement and PARSER OUTPUT
 * THAT PARSES TO THE SAME CONTENT is idempotent (finds and reuses the existing row, touching
 * nothing); re-running with the SAME announcement but DIFFERENT parsed content (e.g. a parser
 * bug fix recovering previously-lost text) creates a NEW, separate version row — the old row,
 * its provisions, and every completed corpus run / History entry / cache row already pointing at
 * it are never mutated or deleted. A different announcement for the same base act always creates
 * a new version row too, as before (see current-law-corpus Phase 1 design: immutability is the
 * whole point — this extends it from "per announcement" to "per announcement AND per parsed
 * content revision").
 *
 * Provenance is verified, not assumed: both the base act's "Inf. o tekście jednolitym" relation
 * and the announcement's "Tekst jednolity dla aktu" back-reference must agree before anything is
 * written — a mismatched or unrelated pair is rejected.
 */
export async function ingestOfficialConsolidatedStructure(
  input: IngestOfficialConsolidatedStructureInput,
): Promise<IngestOfficialConsolidatedStructureResult> {
  const fetchMetadata = input.fetchMetadata ?? fetchEliActMetadata;
  const fetchReferences = input.fetchReferences ?? fetchEliActReferences;
  const fetchHtml = input.fetchHtml ?? defaultFetchHtml();

  const baseCoords = parseSourceId(input.baseActSourceId);
  const announcementCoords = parseSourceId(input.announcementActSourceId);

  // Step 1: resolve/fetch official metadata for BOTH acts.
  const [baseMetadata, announcementMetadata] = await Promise.all([
    fetchMetadata(baseCoords),
    fetchMetadata(announcementCoords),
  ]);

  const baseMetadataSourceId = `${baseMetadata.publisher}/${baseMetadata.year}/${baseMetadata.pos}`;
  if (baseMetadataSourceId !== input.baseActSourceId) {
    throw new ConsolidatedIngestError(
      `Fetched base act metadata identifies as ${baseMetadataSourceId}, not the requested ${input.baseActSourceId} — refusing a mismatched fetch.`,
    );
  }

  // Steps 2-3: confirm provenance BOTH ways before touching the database.
  const baseReferences = await fetchReferences(baseCoords);
  if (!referencesContain(baseReferences, "Inf. o tekście jednolitym", input.announcementActSourceId)) {
    throw new ConsolidatedIngestError(
      `Base act ${input.baseActSourceId} does not list ${input.announcementActSourceId} under "Inf. o tekście jednolitym" — refusing to ingest an unverified announcement.`,
    );
  }

  const announcementReferences = await fetchReferences(announcementCoords);
  if (!referencesContain(announcementReferences, "Tekst jednolity dla aktu", input.baseActSourceId)) {
    throw new ConsolidatedIngestError(
      `Announcement ${input.announcementActSourceId} does not reference ${input.baseActSourceId} back under "Tekst jednolity dla aktu" — refusing a mismatched base/announcement pair.`,
    );
  }

  // Step 4: the base act must already exist (this pipeline never creates base acts); the
  // announcement act is ingested as its own first-class legal_acts row if it doesn't yet exist.
  const [baseAct] = await input.db
    .select({ id: legalActs.id })
    .from(legalActs)
    .where(and(eq(legalActs.source, ELI_SOURCE), eq(legalActs.sourceId, input.baseActSourceId)))
    .limit(1);
  if (!baseAct) {
    throw new ConsolidatedIngestError(
      `No legal_acts row found for base act ${input.baseActSourceId} — ingest the base act (ingestEliActMetadata) first.`,
    );
  }

  const announcementAct = await findOrInsertLegalAct(input.db, announcementMetadata);

  // Steps 5-6: fetch the announcement's HTML, extract ONLY the semantic consolidated-statute
  // annex (never the announcement's own administrative preamble — parseActStructureHtml throws a
  // typed AnnexSelectionError if the boundary can't be determined unambiguously), and fingerprint
  // the resulting PARSED CONTENT. This must happen BEFORE any version-row decision: the content
  // hash, not just (baseAct, announcement), is now part of a version's real identity — two
  // parses of the SAME announcement that disagree on structure/text (e.g. a parser bug fix) are
  // two DIFFERENT immutable revisions, never one row silently replaced in place.
  const html = await fetchHtml(announcementCoords);
  const parsed = parseActStructureHtml(html, "consolidated_annex");
  const contentHash = computeParsedContentHash(parsed);

  // Step 7: find-or-create the IMMUTABLE base-act version for THIS EXACT (announcement, content)
  // pair. Same announcement + same hash => idempotently reuse the existing row untouched (no
  // re-insert at all — its provisions are guaranteed identical by construction). Same
  // announcement + a DIFFERENT hash (e.g. corrected parser output) => a brand-new version row,
  // never a destructive replace of the old one — the old row, its provisions, and every
  // completed corpus run / History entry / cache row that already points at it remain untouched.
  const [existingVersion] = await input.db
    .select({ id: legalActVersions.id })
    .from(legalActVersions)
    .where(
      and(
        eq(legalActVersions.legalActId, baseAct.id),
        eq(legalActVersions.sourceAnnouncementLegalActId, announcementAct.id),
        eq(legalActVersions.contentHash, contentHash),
      ),
    )
    .limit(1);

  if (existingVersion) {
    return {
      baseLegalActId: baseAct.id,
      announcementLegalActId: announcementAct.id,
      legalActVersionId: existingVersion.id,
      versionAction: "reused",
      deletedCount: 0,
      insertedCount: 0,
    };
  }

  const [inserted] = await input.db
    .insert(legalActVersions)
    .values({
      legalActId: baseAct.id,
      versionKind: "consolidated",
      sourceExpressionId: "tj",
      sourceAnnouncementLegalActId: announcementAct.id,
      authorityClass: "authoritative",
      nonAuthoritative: false,
      currentnessStatus: "unproven",
      legalStateDate: announcementMetadata.legalStatusDate ?? null,
      contentHash,
      // Content-hash-qualified: distinct parsed revisions of the same announcement must never
      // collide on legal_act_versions_source_document_uidx (legalActId, sourceDocumentKey).
      sourceDocumentKey: `announcement:${input.announcementActSourceId}:${contentHash}`,
      sourceHtmlUrl: `https://api.sejm.gov.pl/eli/acts/${announcementCoords.publisher}/${announcementCoords.year}/${announcementCoords.position}/text.html`,
      isCurrent: false,
    })
    .returning({ id: legalActVersions.id });
  const legalActVersionId = inserted.id;

  // Step 8: populate the brand-new (guaranteed-empty) revision's provisions. Reuses the existing
  // transactional delete+insert core unchanged — for a freshly inserted version id the "delete"
  // step is a genuine no-op (existingCount is provably 0), so this is exactly a transactional
  // creation of the new revision, never a replacement of anything another run/entry/cache row
  // could already be pointing at.
  const { deletedCount, insertedCount } = await replaceProvisionsForVersion({
    db: input.db,
    legalActVersionId,
    parsed,
    allowDestructiveShrink: input.allowDestructiveShrink,
  });

  return {
    baseLegalActId: baseAct.id,
    announcementLegalActId: announcementAct.id,
    legalActVersionId,
    versionAction: "inserted",
    deletedCount,
    insertedCount,
  };
}
