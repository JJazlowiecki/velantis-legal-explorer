import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema";
import { legalActVersions, legalActs } from "../../../db/schema";
import { computeParsedContentHash } from "../eli/content-hash";
import { fetchEliActMetadata, fetchEliActReferences } from "../eli/client";
import { mapEliMetadataToLegalAct } from "../eli/ingest";
import { ELI_SOURCE, type EliActMetadata } from "../eli/schema";
import { replaceProvisionsForVersion, StructureIngestError } from "../eli/structure-ingest";
import { extractPdfLines } from "./extract";
import { parseConsolidatedPdfText } from "./structure";

export class PdfConsolidatedIngestError extends StructureIngestError {}

type Db = PostgresJsDatabase<typeof schema>;

export interface IngestOfficialConsolidatedPdfInput {
  db: Db;
  /** e.g. "DU/1964/93" — the base statute (KC, KPA, ...). Must already exist in legal_acts. */
  baseActSourceId: string;
  /** e.g. "DU/2026/795" — the official "Obwieszczenie ... jednolitego tekstu ustawy" act. */
  announcementActSourceId: string;
  allowDestructiveShrink?: boolean;
  fetchMetadata?: typeof fetchEliActMetadata;
  fetchReferences?: typeof fetchEliActReferences;
  fetchPdfBytes?: (url: string) => Promise<Uint8Array>;
}

export interface IngestOfficialConsolidatedPdfResult {
  baseLegalActId: string;
  announcementLegalActId: string;
  legalActVersionId: string;
  versionAction: "inserted" | "reused";
  deletedCount: number;
  insertedCount: number;
  sourcePdfUrl: string;
}

function parseSourceId(sourceId: string): { publisher: string; year: number; position: number } {
  const [publisher, yearStr, positionStr] = sourceId.split("/");
  const year = Number(yearStr);
  const position = Number(positionStr);
  if (!publisher || !Number.isInteger(year) || !Number.isInteger(position)) {
    throw new PdfConsolidatedIngestError(`Malformed sourceId "${sourceId}" — expected "PUBLISHER/YEAR/POSITION"`);
  }
  return { publisher, year, position };
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

  if (existing) return existing;

  const [inserted] = await db.insert(legalActs).values(actData).returning({ id: legalActs.id, sourceId: legalActs.sourceId });
  return inserted;
}

/**
 * Resolves the announcement's official PDF "consolidated text" attachment URL from its ELI
 * metadata `texts` array (type "T" — verified live against real KC/KPA/KK announcements: "O" is
 * the announcement body itself in original-scan form, "I" its informational twin, "T" is the
 * actual "Załącznik ... tekst jednolity" annex PDF, occasionally accompanied by an extra "U"/"Lj"
 * variant this pipeline never uses). Fails closed — never falls back to "O" and silently ingests
 * the announcement's own preamble as if it were the statute.
 */
function resolveConsolidatedTextPdfUrl(
  metadata: EliActMetadata,
  coords: { publisher: string; year: number; position: number },
): string {
  const textEntry = metadata.texts?.find((t) => t.type === "T");
  if (!textEntry) {
    throw new PdfConsolidatedIngestError(
      `Announcement ${coords.publisher}/${coords.year}/${coords.position} has no "T" (consolidated text) PDF attachment in its ELI metadata — refusing to guess an alternative.`,
    );
  }
  return `https://api.sejm.gov.pl/eli/acts/${coords.publisher}/${coords.year}/${coords.position}/text/T/${textEntry.fileName}`;
}

function defaultFetchPdfBytes(): (url: string) => Promise<Uint8Array> {
  return async (url) => {
    const response = await fetch(url, {
      headers: { "User-Agent": "Velantis-Legal-Explorer/0.1 (+https://velantis.local)" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new PdfConsolidatedIngestError(`Failed to fetch consolidated-text PDF: HTTP ${response.status} (${url})`);
    }
    return new Uint8Array(await response.arrayBuffer());
  };
}

/**
 * PDF-sourced sibling of eli/consolidated-ingest.ts's ingestOfficialConsolidatedStructure —
 * identical provenance verification, identical immutable-revision identity (triple of baseAct,
 * announcementAct, contentHash via the SAME computeParsedContentHash used by the HTML path, since
 * ParsedProvision[] is source-format-agnostic), identical reuse of replaceProvisionsForVersion.
 * The ONLY difference is where the parsed structure comes from: the announcement's official "T"
 * PDF attachment (extractPdfLines + parseConsolidatedPdfText) instead of its text.html. Used
 * exactly when metadata.textHTML is false and metadata.textPDF is true — see prepare-current-
 * law-corpus.ts for the selection between the two paths.
 */
export async function ingestOfficialConsolidatedPdf(
  input: IngestOfficialConsolidatedPdfInput,
): Promise<IngestOfficialConsolidatedPdfResult> {
  const fetchMetadata = input.fetchMetadata ?? fetchEliActMetadata;
  const fetchReferences = input.fetchReferences ?? fetchEliActReferences;
  const fetchPdfBytes = input.fetchPdfBytes ?? defaultFetchPdfBytes();

  const baseCoords = parseSourceId(input.baseActSourceId);
  const announcementCoords = parseSourceId(input.announcementActSourceId);

  const [baseMetadata, announcementMetadata] = await Promise.all([
    fetchMetadata(baseCoords),
    fetchMetadata(announcementCoords),
  ]);

  const baseMetadataSourceId = `${baseMetadata.publisher}/${baseMetadata.year}/${baseMetadata.pos}`;
  if (baseMetadataSourceId !== input.baseActSourceId) {
    throw new PdfConsolidatedIngestError(
      `Fetched base act metadata identifies as ${baseMetadataSourceId}, not the requested ${input.baseActSourceId} — refusing a mismatched fetch.`,
    );
  }

  const baseReferences = await fetchReferences(baseCoords);
  if (!referencesContain(baseReferences, "Inf. o tekście jednolitym", input.announcementActSourceId)) {
    throw new PdfConsolidatedIngestError(
      `Base act ${input.baseActSourceId} does not list ${input.announcementActSourceId} under "Inf. o tekście jednolitym" — refusing to ingest an unverified announcement.`,
    );
  }

  const announcementReferences = await fetchReferences(announcementCoords);
  if (!referencesContain(announcementReferences, "Tekst jednolity dla aktu", input.baseActSourceId)) {
    throw new PdfConsolidatedIngestError(
      `Announcement ${input.announcementActSourceId} does not reference ${input.baseActSourceId} back under "Tekst jednolity dla aktu" — refusing a mismatched base/announcement pair.`,
    );
  }

  const [baseAct] = await input.db
    .select({ id: legalActs.id })
    .from(legalActs)
    .where(and(eq(legalActs.source, ELI_SOURCE), eq(legalActs.sourceId, input.baseActSourceId)))
    .limit(1);
  if (!baseAct) {
    throw new PdfConsolidatedIngestError(
      `No legal_acts row found for base act ${input.baseActSourceId} — ingest the base act (ingestEliActMetadata) first.`,
    );
  }

  const announcementAct = await findOrInsertLegalAct(input.db, announcementMetadata);

  const sourcePdfUrl = resolveConsolidatedTextPdfUrl(announcementMetadata, announcementCoords);
  const pdfBytes = await fetchPdfBytes(sourcePdfUrl);
  const lines = await extractPdfLines(pdfBytes);
  const parsed = parseConsolidatedPdfText(lines);
  const contentHash = computeParsedContentHash(parsed);

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
      sourcePdfUrl,
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
      sourceDocumentKey: `announcement:${input.announcementActSourceId}:${contentHash}`,
      sourcePdfUrl,
      sourceUnifiedPdfUrl: sourcePdfUrl,
      isCurrent: false,
    })
    .returning({ id: legalActVersions.id });
  const legalActVersionId = inserted.id;

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
    sourcePdfUrl,
  };
}
