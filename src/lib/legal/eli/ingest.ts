import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import * as schema from "../../../db/schema";
import { legalActResources, legalActs, legalActVersions } from "../../../db/schema";
import {
  type EliActMetadata,
  ELI_API_BASE_URL,
  ELI_SOURCE,
} from "./schema";
import { buildActApiUrl, fetchEliActMetadata } from "./client";

const UNKNOWN_VERSION_KEY = "SEJM_ELI:UNKNOWN_VERSION";

const cliArgsSchema = z.object({
  publisher: z
    .string()
    .min(1, "--publisher is required")
    .regex(/^[A-Za-z]{1,12}$/, "--publisher must only contain letters")
    .transform((value) => value.toUpperCase()),
  year: z.coerce
    .number({ error: "--year is required" })
    .int("--year must be an integer")
    .min(1800, "--year must be >= 1800")
    .max(2200, "--year must be <= 2200"),
  position: z.coerce
    .number({ error: "--position is required" })
    .int("--position must be an integer")
    .positive("--position must be > 0"),
});

export type IngestCliArgs = z.infer<typeof cliArgsSchema>;

export class CliValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliValidationError";
  }
}

export interface IngestResult {
  sourceId: string;
  title: string;
  actAction: "inserted" | "updated" | "unchanged";
  versions: {
    inserted: number;
    updated: number;
    unchanged: number;
  };
  resources: {
    inserted: number;
    updated: number;
    unchanged: number;
  };
}

export interface IngestOptions {
  now?: Date;
  fetchMetadata?: typeof fetchEliActMetadata;
  db?: PostgresJsDatabase<typeof schema>;
}

type LegalActInsertInput = typeof legalActs.$inferInsert;
type LegalActVersionInsertInput = typeof legalActVersions.$inferInsert;
type LegalActResourceInsertInput = typeof legalActResources.$inferInsert;
type LegalActVersionDraft = Omit<
  LegalActVersionInsertInput,
  "id" | "legalActId" | "fetchedAt" | "createdAt" | "updatedAt"
>;
type LegalActResourceDraft = Omit<
  LegalActResourceInsertInput,
  "id" | "legalActVersionId" | "createdAt" | "updatedAt"
>;

export function parseIngestCliArgs(argv: string[]): IngestCliArgs {
  const parsed: Record<string, string | undefined> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];

    if (!current.startsWith("--")) {
      throw new CliValidationError(`Unexpected argument: ${current}`);
    }

    const key = current.slice(2);
    const value = argv[i + 1];

    if (!value || value.startsWith("--")) {
      throw new CliValidationError(`Missing value for --${key}`);
    }

    parsed[key] = value;
    i += 1;
  }

  const result = cliArgsSchema.safeParse({
    publisher: parsed.publisher,
    year: parsed.year,
    position: parsed.position,
  });

  if (!result.success) {
    throw new CliValidationError(result.error.issues[0]?.message ?? "Invalid arguments");
  }

  return result.data;
}

export function mapEliMetadataToLegalAct(metadata: EliActMetadata): LegalActInsertInput {
  const sourceId = `${metadata.publisher}/${metadata.year}/${metadata.pos}`;

  return {
    jurisdiction: "PL",
    source: ELI_SOURCE,
    sourceId,
    title: metadata.title,
    actType: metadata.type ?? "unknown",
    publisher: metadata.publisher,
    journalYear: metadata.year,
    journalPosition: metadata.pos,
    announcementDate: metadata.announcementDate ?? null,
    promulgationDate: metadata.promulgation ?? null,
    entryIntoForceDate: metadata.entryIntoForce ?? metadata.validFrom ?? null,
    expirationDate: null,
    status: metadata.status ?? null,
    inForce:
      typeof metadata.inForce === "string"
        ? metadata.inForce.toUpperCase() === "IN_FORCE"
        : metadata.inForce ?? null,
    eliUri: metadata.ELI ?? sourceId,
    officialPageUrl: buildActApiUrl(
      {
        publisher: metadata.publisher,
        year: metadata.year,
        position: metadata.pos,
      },
      ELI_API_BASE_URL,
    ),
  };
}

export function mapEliMetadataToLegalActVersion(metadata: EliActMetadata): LegalActVersionDraft {
  const sourceUpdatedAt = metadata.changeDate ? new Date(metadata.changeDate) : null;
  const effectiveFrom = metadata.validFrom ?? metadata.entryIntoForce ?? null;

  return {
    versionKind: "unknown",
    legalStateDate: null,
    effectiveFrom,
    effectiveTo: null,
    sourceDocumentKey: UNKNOWN_VERSION_KEY,
    sourceUpdatedAt,
    contentHash: null,
    sourceHtmlUrl: null,
    sourcePdfUrl: null,
    sourceUnifiedPdfUrl: null,
    isCurrent: false,
  };
}

function detectRepresentationType(fileName: string): string {
  const normalized = fileName.toLowerCase();

  if (normalized.endsWith(".html") || normalized.endsWith(".htm")) {
    return "html";
  }

  if (normalized.endsWith(".pdf")) {
    return "pdf";
  }

  return "other";
}

export function mapEliMetadataToLegalActResources(metadata: EliActMetadata): LegalActResourceDraft[] {
  const baseActUrl = buildActApiUrl(
    {
      publisher: metadata.publisher,
      year: metadata.year,
      position: metadata.pos,
    },
    ELI_API_BASE_URL,
  );

  const resources = new Map<
    string,
    {
      fileName: string;
      sourceUrl: string;
      representationType: string;
      sourceTypeCodes: Set<string>;
    }
  >();

  for (const item of metadata.texts ?? []) {
    const fileName = item.fileName;
    const sourceUrl = `${baseActUrl}/${encodeURIComponent(fileName)}`;
    const sourceTypeCode = item.type?.trim().toUpperCase() || "UNKNOWN";

    const existing = resources.get(sourceUrl);
    if (existing) {
      existing.sourceTypeCodes.add(sourceTypeCode);
      continue;
    }

    resources.set(sourceUrl, {
      fileName,
      sourceUrl,
      representationType: detectRepresentationType(fileName),
      sourceTypeCodes: new Set([sourceTypeCode]),
    });
  }

  const hasHtmlResource = [...resources.values()].some(
    (resource) => resource.representationType === "html",
  );

  if (metadata.textHTML && !hasHtmlResource) {
    const fallbackHtmlFileName = "text.html";
    const fallbackHtmlUrl = `${baseActUrl}/${fallbackHtmlFileName}`;
    resources.set(fallbackHtmlUrl, {
      fileName: fallbackHtmlFileName,
      sourceUrl: fallbackHtmlUrl,
      representationType: "html",
      sourceTypeCodes: new Set(["UNKNOWN"]),
    });
  }

  return [...resources.values()]
    .map((resource) => ({
      sourceTypeCodes: [...resource.sourceTypeCodes].sort().join(","),
      representationType: resource.representationType,
      fileName: resource.fileName,
      sourceUrl: resource.sourceUrl,
      contentHash: null,
    }))
    .sort((a, b) => a.sourceUrl.localeCompare(b.sourceUrl));
}

function areActFieldsEqual(existing: typeof legalActs.$inferSelect, next: LegalActInsertInput): boolean {
  return (
    existing.jurisdiction === next.jurisdiction &&
    existing.title === next.title &&
    existing.actType === next.actType &&
    existing.publisher === next.publisher &&
    existing.journalYear === next.journalYear &&
    existing.journalPosition === next.journalPosition &&
    existing.announcementDate === next.announcementDate &&
    existing.promulgationDate === next.promulgationDate &&
    existing.entryIntoForceDate === next.entryIntoForceDate &&
    existing.expirationDate === next.expirationDate &&
    existing.status === next.status &&
    existing.inForce === next.inForce &&
    existing.eliUri === next.eliUri &&
    existing.officialPageUrl === next.officialPageUrl
  );
}

function areVersionFieldsEqual(
  existing: typeof legalActVersions.$inferSelect,
  next: LegalActVersionInsertInput,
): boolean {
  const existingSourceUpdatedAt = existing.sourceUpdatedAt?.toISOString() ?? null;
  const nextSourceUpdatedAt = next.sourceUpdatedAt?.toISOString() ?? null;

  return (
    existing.versionKind === next.versionKind &&
    existing.legalStateDate === next.legalStateDate &&
    existing.effectiveFrom === next.effectiveFrom &&
    existing.effectiveTo === next.effectiveTo &&
    existingSourceUpdatedAt === nextSourceUpdatedAt &&
    existing.contentHash === next.contentHash &&
    existing.sourceHtmlUrl === next.sourceHtmlUrl &&
    existing.sourcePdfUrl === next.sourcePdfUrl &&
    existing.sourceUnifiedPdfUrl === next.sourceUnifiedPdfUrl &&
    existing.isCurrent === next.isCurrent
  );
}

export async function ingestEliActMetadata(args: IngestCliArgs, options: IngestOptions = {}) {
  const now = options.now ?? new Date();
  const fetchMetadata = options.fetchMetadata ?? fetchEliActMetadata;
  const db =
    options.db ??
    (await import("../../../db/script-db")).getScriptDb();

  const metadata = await fetchMetadata({
    publisher: args.publisher,
    year: args.year,
    position: args.position,
  });

  const actData = mapEliMetadataToLegalAct(metadata);
  const versionData = mapEliMetadataToLegalActVersion(metadata);
  const resourceData = mapEliMetadataToLegalActResources(metadata);

  return db.transaction(async (tx) => {
    const existingAct = (
      await tx
        .select()
        .from(legalActs)
        .where(and(eq(legalActs.source, ELI_SOURCE), eq(legalActs.sourceId, actData.sourceId)))
        .limit(1)
    )[0];

    let legalActId: string;
    let actAction: IngestResult["actAction"];

    if (!existingAct) {
      const inserted = await tx.insert(legalActs).values(actData).returning({ id: legalActs.id });
      legalActId = inserted[0].id;
      actAction = "inserted";
    } else if (!areActFieldsEqual(existingAct, actData)) {
      const updated = await tx
        .update(legalActs)
        .set({
          ...actData,
          updatedAt: now,
        })
        .where(eq(legalActs.id, existingAct.id))
        .returning({ id: legalActs.id });

      legalActId = updated[0].id;
      actAction = "updated";
    } else {
      legalActId = existingAct.id;
      actAction = "unchanged";
    }

    const versionCounters = {
      inserted: 0,
      updated: 0,
      unchanged: 0,
    };

    const allVersions = await tx
      .select()
      .from(legalActVersions)
      .where(eq(legalActVersions.legalActId, legalActId));

    const versionsToRemove = allVersions
      .filter((version) => version.sourceDocumentKey !== UNKNOWN_VERSION_KEY)
      .map((version) => version.id);

    if (versionsToRemove.length > 0) {
      await tx
        .delete(legalActVersions)
        .where(inArray(legalActVersions.id, versionsToRemove));
    }

    const existingVersion = (
      await tx
        .select()
        .from(legalActVersions)
        .where(
          and(
            eq(legalActVersions.legalActId, legalActId),
            eq(legalActVersions.sourceDocumentKey, versionData.sourceDocumentKey),
          ),
        )
        .limit(1)
    )[0];

    const versionPayload: LegalActVersionInsertInput = {
      ...versionData,
      legalActId,
    };

    let legalActVersionId: string;

    if (!existingVersion) {
      const insertedVersion = await tx
        .insert(legalActVersions)
        .values(versionPayload)
        .returning({ id: legalActVersions.id });
      legalActVersionId = insertedVersion[0].id;
      versionCounters.inserted += 1;
    } else if (areVersionFieldsEqual(existingVersion, versionPayload)) {
      legalActVersionId = existingVersion.id;
      versionCounters.unchanged += 1;
    } else {
      const updatedVersion = await tx
        .update(legalActVersions)
        .set({
          ...versionPayload,
          updatedAt: now,
        })
        .where(eq(legalActVersions.id, existingVersion.id))
        .returning({ id: legalActVersions.id });
      legalActVersionId = updatedVersion[0].id;
      versionCounters.updated += 1;
    }

    const resourcesCounters = {
      inserted: 0,
      updated: 0,
      unchanged: 0,
    };

    for (const resource of resourceData) {
      const existingResource = (
        await tx
          .select()
          .from(legalActResources)
          .where(
            and(
              eq(legalActResources.legalActVersionId, legalActVersionId),
              eq(legalActResources.sourceUrl, resource.sourceUrl),
            ),
          )
          .limit(1)
      )[0];

      const payload: LegalActResourceInsertInput = {
        ...resource,
        legalActVersionId,
      };

      if (!existingResource) {
        await tx.insert(legalActResources).values(payload);
        resourcesCounters.inserted += 1;
        continue;
      }

      const resourceUnchanged =
        existingResource.sourceTypeCodes === payload.sourceTypeCodes &&
        existingResource.representationType === payload.representationType &&
        existingResource.fileName === payload.fileName &&
        existingResource.sourceUrl === payload.sourceUrl &&
        existingResource.contentHash === payload.contentHash;

      if (resourceUnchanged) {
        resourcesCounters.unchanged += 1;
        continue;
      }

      await tx
        .update(legalActResources)
        .set({
          ...payload,
          updatedAt: now,
        })
        .where(eq(legalActResources.id, existingResource.id));
      resourcesCounters.updated += 1;
    }

    return {
      sourceId: actData.sourceId,
      title: actData.title,
      actAction,
      versions: versionCounters,
      resources: resourcesCounters,
    } satisfies IngestResult;
  });
}
