import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import * as schema from "../../../db/schema";
import { legalActResources, legalActs, legalActVersions } from "../../../db/schema";
import { buildActApiUrl, fetchEliActMetadata } from "./client";
import {
  choosePreferredCurrentExpression,
  discoverOfficialExpressions,
  toExpressionCandidate,
  type DiscoveredOfficialExpression,
  type ExpressionSelectionResult,
} from "./expressions";
import {
  type EliActMetadata,
  ELI_API_BASE_URL,
  ELI_SOURCE,
  type ExpressionAuthorityClass,
  type LegalActVersionKind,
} from "./schema";

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
    resolvedCount: number;
    unresolvedCount: number;
  };
  sourceSelection: {
    retrievalVersion: string | null;
    authoritativeVersion: string | null;
    retrievalReason: string;
    authorityReason: string;
    warnings: string[];
  };
}

export interface IngestOptions {
  now?: Date;
  fetchMetadata?: typeof fetchEliActMetadata;
  discoverExpressions?: typeof discoverOfficialExpressions;
  db?: PostgresJsDatabase<typeof schema>;
}

type LegalActInsertInput = typeof legalActs.$inferInsert;
type LegalActVersionInsertInput = typeof legalActVersions.$inferInsert;
type LegalActResourceInsertInput = typeof legalActResources.$inferInsert;
type LegalActVersionDraft = {
  versionKind: LegalActVersionKind;
  legalStateDate: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  sourceExpressionId: string;
  canonicalEliUri: string | null;
  authorityClass: ExpressionAuthorityClass;
  nonAuthoritative: boolean;
  currentnessStatus: "proven_current" | "unproven";
  sourceDocumentKey: string;
  sourceUpdatedAt: Date | null;
  contentHash: string | null;
  sourceHtmlUrl: string | null;
  sourcePdfUrl: string | null;
  sourceUnifiedPdfUrl: string | null;
  isCurrent: boolean;
};

type LegalActResourceDraft = Omit<
  LegalActResourceInsertInput,
  "id" | "legalActId" | "legalActVersionId" | "createdAt" | "updatedAt"
>;

type VersionWithResourcesDraft = {
  version: LegalActVersionDraft;
  resources: LegalActResourceDraft[];
};

export interface IngestDraftBundle {
  versions: VersionWithResourcesDraft[];
  unresolvedActResources: LegalActResourceDraft[];
  selection: ExpressionSelectionResult;
}

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

export function mapEliMetadataToRawResources(metadata: EliActMetadata): LegalActResourceDraft[] {
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
    const sourceTypeCode = item.type?.trim().toUpperCase() || "UNKNOWN";
    const sourceUrl = `${baseActUrl}/${encodeURIComponent(item.fileName)}`;

    const existing = resources.get(sourceUrl);
    if (existing) {
      existing.sourceTypeCodes.add(sourceTypeCode);
      continue;
    }

    resources.set(sourceUrl, {
      fileName: item.fileName,
      sourceUrl,
      representationType: detectRepresentationType(item.fileName),
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

function mapDiscoveredExpressionToVersionDraft(
  metadata: EliActMetadata,
  expression: DiscoveredOfficialExpression,
): LegalActVersionDraft {
  const sourceUpdatedAt = metadata.changeDate ? new Date(metadata.changeDate) : null;
  const candidate = toExpressionCandidate(
    {
      sourceExpressionId: expression.sourceExpressionId,
      versionKind: expression.versionKind,
      canonicalEliUri: expression.canonicalEliUri,
      evidence: expression.evidence,
    },
    "unproven",
  );

  return {
    versionKind: expression.versionKind,
    legalStateDate: null,
    effectiveFrom: metadata.validFrom ?? metadata.entryIntoForce ?? null,
    effectiveTo: null,
    sourceExpressionId: expression.sourceExpressionId,
    canonicalEliUri: expression.canonicalEliUri,
    authorityClass: candidate.authorityClass,
    nonAuthoritative: candidate.nonAuthoritative,
    currentnessStatus: candidate.currentnessStatus,
    sourceDocumentKey: `expression:${expression.sourceExpressionId}`,
    sourceUpdatedAt,
    contentHash: null,
    sourceHtmlUrl: null,
    sourcePdfUrl: null,
    sourceUnifiedPdfUrl: null,
    isCurrent: false,
  };
}

function mapCanonicalExpressionResource(expression: DiscoveredOfficialExpression): LegalActResourceDraft {
  return {
    sourceTypeCodes: "OFFICIAL_ELI_EXPRESSION",
    representationType: "eli_expression",
    fileName: `${expression.sourceExpressionId}.eli`,
    sourceUrl: expression.canonicalEliUri,
    contentHash: null,
  };
}

export function buildVersionAndResourceDrafts(
  metadata: EliActMetadata,
  discoveredExpressions: DiscoveredOfficialExpression[],
): IngestDraftBundle {
  const versions: VersionWithResourcesDraft[] = discoveredExpressions.map((expression) => ({
    version: mapDiscoveredExpressionToVersionDraft(metadata, expression),
    resources: [mapCanonicalExpressionResource(expression)],
  }));

  const unresolvedActResources = mapEliMetadataToRawResources(metadata);

  const selection = choosePreferredCurrentExpression(
    versions.map((entry) => ({
      sourceExpressionId: entry.version.sourceExpressionId,
      versionKind: entry.version.versionKind,
      canonicalEliUri: entry.version.canonicalEliUri,
      evidence: `official_expression:${entry.version.sourceExpressionId}`,
    })),
  );

  // Reachability alone is not enough to claim currentness.
  for (const entry of versions) {
    entry.version.isCurrent = false;
    entry.version.currentnessStatus = "unproven";
  }

  return {
    versions,
    unresolvedActResources,
    selection,
  };
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
    existing.sourceExpressionId === next.sourceExpressionId &&
    existing.canonicalEliUri === next.canonicalEliUri &&
    existing.authorityClass === next.authorityClass &&
    existing.nonAuthoritative === next.nonAuthoritative &&
    existing.currentnessStatus === next.currentnessStatus &&
    existing.sourceDocumentKey === next.sourceDocumentKey &&
    existingSourceUpdatedAt === nextSourceUpdatedAt &&
    existing.contentHash === next.contentHash &&
    existing.sourceHtmlUrl === next.sourceHtmlUrl &&
    existing.sourcePdfUrl === next.sourcePdfUrl &&
    existing.sourceUnifiedPdfUrl === next.sourceUnifiedPdfUrl &&
    existing.isCurrent === next.isCurrent
  );
}

function areResourceFieldsEqual(
  existing: typeof legalActResources.$inferSelect,
  next: LegalActResourceInsertInput,
): boolean {
  return (
    existing.legalActId === next.legalActId &&
    (existing.legalActVersionId ?? null) === (next.legalActVersionId ?? null) &&
    existing.sourceTypeCodes === next.sourceTypeCodes &&
    existing.representationType === next.representationType &&
    existing.fileName === next.fileName &&
    existing.sourceUrl === next.sourceUrl &&
    existing.contentHash === next.contentHash
  );
}

export async function ingestEliActMetadata(args: IngestCliArgs, options: IngestOptions = {}) {
  const now = options.now ?? new Date();
  const fetchMetadata = options.fetchMetadata ?? fetchEliActMetadata;
  const discoverExpressions = options.discoverExpressions ?? discoverOfficialExpressions;
  const db = options.db ?? (await import("../../../db/script-db")).getScriptDb();

  const metadata = await fetchMetadata({
    publisher: args.publisher,
    year: args.year,
    position: args.position,
  });

  const discoveredExpressions = await discoverExpressions(metadata);
  const drafts = buildVersionAndResourceDrafts(metadata, discoveredExpressions);
  const actData = mapEliMetadataToLegalAct(metadata);

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

    const desiredExpressionIds = drafts.versions.map((entry) => entry.version.sourceExpressionId);

    const existingVersions = await tx
      .select()
      .from(legalActVersions)
      .where(eq(legalActVersions.legalActId, legalActId));

    const versionCounters = {
      inserted: 0,
      updated: 0,
      unchanged: 0,
    };

    const versionIdByExpressionId = new Map<string, string>();

    for (const draft of drafts.versions) {
      const expressionId = draft.version.sourceExpressionId;
      const payload: LegalActVersionInsertInput = {
        ...draft.version,
        legalActId,
      };

      const existingVersion = existingVersions.find((version) => version.sourceExpressionId === expressionId);

      if (!existingVersion) {
        const inserted = await tx
          .insert(legalActVersions)
          .values(payload)
          .returning({ id: legalActVersions.id });
        versionIdByExpressionId.set(expressionId, inserted[0].id);
        versionCounters.inserted += 1;
        continue;
      }

      if (areVersionFieldsEqual(existingVersion, payload)) {
        versionIdByExpressionId.set(expressionId, existingVersion.id);
        versionCounters.unchanged += 1;
        continue;
      }

      const updated = await tx
        .update(legalActVersions)
        .set({
          ...payload,
          updatedAt: now,
        })
        .where(eq(legalActVersions.id, existingVersion.id))
        .returning({ id: legalActVersions.id });

      versionIdByExpressionId.set(expressionId, updated[0].id);
      versionCounters.updated += 1;
    }

    const staleVersions = existingVersions
      .filter((version) => !desiredExpressionIds.includes(version.sourceExpressionId))
      .map((version) => version.id);

    if (staleVersions.length > 0) {
      await tx.delete(legalActVersions).where(inArray(legalActVersions.id, staleVersions));
    }

    const desiredResources: LegalActResourceInsertInput[] = [];

    for (const draft of drafts.versions) {
      const legalActVersionId = versionIdByExpressionId.get(draft.version.sourceExpressionId) ?? null;
      for (const resourceDraft of draft.resources) {
        desiredResources.push({
          ...resourceDraft,
          legalActId,
          legalActVersionId,
        });
      }
    }

    for (const unresolved of drafts.unresolvedActResources) {
      desiredResources.push({
        ...unresolved,
        legalActId,
        legalActVersionId: null,
      });
    }

    const resourcesCounters = {
      inserted: 0,
      updated: 0,
      unchanged: 0,
    };

    const existingResources = await tx
      .select()
      .from(legalActResources)
      .where(eq(legalActResources.legalActId, legalActId));

    for (const payload of desiredResources) {
      const existingResource = existingResources.find((resource) => resource.sourceUrl === payload.sourceUrl);

      if (!existingResource) {
        await tx.insert(legalActResources).values(payload);
        resourcesCounters.inserted += 1;
        continue;
      }

      if (areResourceFieldsEqual(existingResource, payload)) {
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

    const desiredResourceUrls = desiredResources.map((resource) => resource.sourceUrl);
    if (desiredResourceUrls.length === 0) {
      await tx.delete(legalActResources).where(eq(legalActResources.legalActId, legalActId));
    } else {
      await tx
        .delete(legalActResources)
        .where(
          and(
            eq(legalActResources.legalActId, legalActId),
            notInArray(legalActResources.sourceUrl, desiredResourceUrls),
          ),
        );
    }

    return {
      sourceId: actData.sourceId,
      title: actData.title,
      actAction,
      versions: versionCounters,
      resources: {
        ...resourcesCounters,
        resolvedCount: desiredResources.filter((resource) => resource.legalActVersionId !== null).length,
        unresolvedCount: desiredResources.filter((resource) => resource.legalActVersionId === null).length,
      },
      sourceSelection: {
        retrievalVersion: drafts.selection.retrievalVersion?.sourceExpressionId ?? null,
        authoritativeVersion: drafts.selection.authoritativeVersion?.sourceExpressionId ?? null,
        retrievalReason: drafts.selection.retrievalReason,
        authorityReason: drafts.selection.authorityReason,
        warnings: drafts.selection.warnings,
      },
    } satisfies IngestResult;
  });
}
