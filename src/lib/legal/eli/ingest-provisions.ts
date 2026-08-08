import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import * as schema from "../../../db/schema";
import { legalActs, legalActVersions, legalProvisions } from "../../../db/schema";
import {
  buildActApiUrl,
  fetchEliActMetadata,
  fetchEliActStruct,
  fetchEliActTextHtml,
  fetchEliActTextHtmlFragment,
  type FetchEliActMetadataInput,
} from "./client";
import { classifyExpressionAuthority } from "./expressions";
import {
  extractProvisionDraftsFromStructure,
  type ProvisionExtractionStats,
  ProvisionExtractionError,
} from "./provisions";
import { type EliActMetadata, ELI_API_BASE_URL, ELI_SOURCE, type LegalActVersionKind } from "./schema";
import { normalizeStructTree } from "./structure";

const PROVISION_INGEST_HTTP_TIMEOUT_MS = 15_000;
const DEFAULT_FRAGMENT_FALLBACK_MAX_REQUESTS = 24;
const DEFAULT_FRAGMENT_FALLBACK_CONCURRENCY = 4;

const cliArgsSchema = z
  .object({
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
    legalActVersionId: z.string().uuid("--legal-act-version-id must be a UUID").optional(),
    sourceExpressionId: z.string().min(1, "--source-expression-id cannot be empty").optional(),
    versionKind: z.enum(["promulgated", "consolidated", "unified", "unknown"]).optional(),
    dryRun: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.legalActVersionId && !value.sourceExpressionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Explicit target legal act version is required: provide --legal-act-version-id or --source-expression-id",
      });
    }
  });

export type IngestProvisionsCliArgs = z.infer<typeof cliArgsSchema>;

export type IngestProvisionsParseResult = IngestProvisionsCliArgs;

export interface IngestProvisionsOptions {
  now?: Date;
  fetchMetadata?: typeof fetchEliActMetadata;
  fetchStruct?: typeof fetchEliActStruct;
  fetchTextHtml?: typeof fetchEliActTextHtml;
  fetchTextHtmlFragment?: typeof fetchEliActTextHtmlFragment;
  db?: PostgresJsDatabase<typeof schema>;
  requestTimeoutMs?: number;
  enableFragmentFallback?: boolean;
  fragmentFallbackMaxRequests?: number;
  fragmentFallbackConcurrency?: number;
  onProgress?: (message: string) => void;
}

export class ProvisionIngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvisionIngestError";
  }
}

export interface IngestProvisionsResult {
  sourceId: string;
  legalActVersionId: string;
  legalActAction: "inserted" | "updated" | "unchanged";
  versionAction: "existing" | "created";
  provisions: {
    inserted: number;
    updated: number;
    unchanged: number;
    deleted: number;
    total: number;
  };
  stats: ProvisionExtractionStats;
  timingsMs: {
    metadataFetch: number;
    structFetch: number;
    htmlFetch: number;
    extract: number;
    persist: number;
    total: number;
  };
}

function parseBooleanLike(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function parseIngestProvisionsCliArgs(argv: string[]): IngestProvisionsParseResult {
  const parsed: Record<string, string | undefined> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];

    if (!current.startsWith("--")) {
      throw new ProvisionIngestError(`Unexpected argument: ${current}`);
    }

    const key = current.slice(2);
    const value = argv[i + 1];

    if (key === "dry-run") {
      parsed[key] = "true";
      continue;
    }

    if (!value || value.startsWith("--")) {
      throw new ProvisionIngestError(`Missing value for --${key}`);
    }

    parsed[key] = value;
    i += 1;
  }

  const result = cliArgsSchema.safeParse({
    publisher: parsed.publisher,
    year: parsed.year,
    position: parsed.position,
    legalActVersionId: parsed["legal-act-version-id"],
    sourceExpressionId: parsed["source-expression-id"],
    versionKind: parsed["version-kind"],
    dryRun: parsed["dry-run"] ? parseBooleanLike(parsed["dry-run"]) : false,
  });

  if (!result.success) {
    throw new ProvisionIngestError(result.error.issues[0]?.message ?? "Invalid arguments");
  }

  return result.data;
}

function mapEliMetadataToLegalAct(metadata: EliActMetadata) {
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
  } satisfies typeof legalActs.$inferInsert;
}

function areActFieldsEqual(
  existing: typeof legalActs.$inferSelect,
  next: typeof legalActs.$inferInsert,
): boolean {
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

function areProvisionFieldsEqual(
  existing: typeof legalProvisions.$inferSelect,
  payload: typeof legalProvisions.$inferInsert,
): boolean {
  return (
    existing.parentProvisionId === (payload.parentProvisionId ?? null) &&
    existing.provisionType === payload.provisionType &&
    existing.article === (payload.article ?? null) &&
    existing.paragraph === (payload.paragraph ?? null) &&
    existing.point === (payload.point ?? null) &&
    existing.letter === (payload.letter ?? null) &&
    existing.citationLabel === payload.citationLabel &&
    existing.heading === (payload.heading ?? null) &&
    existing.text === payload.text &&
    existing.structuralPath === payload.structuralPath &&
    existing.ordinal === payload.ordinal
  );
}

function resolveSourceId(input: FetchEliActMetadataInput): string {
  return `${input.publisher}/${input.year}/${input.position}`;
}

export async function ingestEliProvisions(
  args: IngestProvisionsCliArgs,
  options: IngestProvisionsOptions = {},
): Promise<IngestProvisionsResult> {
  const startedAt = Date.now();
  const now = options.now ?? new Date();
  const timeoutMs = options.requestTimeoutMs ?? PROVISION_INGEST_HTTP_TIMEOUT_MS;
  const reportProgress = options.onProgress ?? (() => undefined);
  const fetchMetadata = options.fetchMetadata
    ? (input: FetchEliActMetadataInput) => options.fetchMetadata!(input)
    : (input: FetchEliActMetadataInput) => fetchEliActMetadata(input, { timeoutMs });
  const fetchStruct = options.fetchStruct
    ? (input: FetchEliActMetadataInput) => options.fetchStruct!(input)
    : (input: FetchEliActMetadataInput) => fetchEliActStruct(input, { timeoutMs });
  const fetchTextHtml = options.fetchTextHtml
    ? (input: FetchEliActMetadataInput) => options.fetchTextHtml!(input)
    : (input: FetchEliActMetadataInput) => fetchEliActTextHtml(input, { timeoutMs });
  const fetchTextHtmlFragment = options.fetchTextHtmlFragment
    ? (input: FetchEliActMetadataInput, treeId: string) => options.fetchTextHtmlFragment!(input, treeId)
    : (input: FetchEliActMetadataInput, treeId: string) =>
        fetchEliActTextHtmlFragment(input, treeId, { timeoutMs });

  const enableFragmentFallback = options.enableFragmentFallback ?? false;
  const fragmentFallbackMaxRequests =
    options.fragmentFallbackMaxRequests ?? DEFAULT_FRAGMENT_FALLBACK_MAX_REQUESTS;
  const fragmentFallbackConcurrency =
    options.fragmentFallbackConcurrency ?? DEFAULT_FRAGMENT_FALLBACK_CONCURRENCY;

  const db = options.db ?? (await import("../../../db/script-db")).getScriptDb();

  const input: FetchEliActMetadataInput = {
    publisher: args.publisher,
    year: args.year,
    position: args.position,
  };

  reportProgress("Fetching act metadata...");
  const metadataStartedAt = Date.now();
  const metadata = await fetchMetadata(input);
  const metadataFetchMs = Date.now() - metadataStartedAt;

  const sourceId = resolveSourceId(input);

  reportProgress("Fetching act structure...");
  const structStartedAt = Date.now();
  const structResponse = await fetchStruct(input);
  const structFetchMs = Date.now() - structStartedAt;
  const normalizedTree = normalizeStructTree(structResponse);

  reportProgress("Fetching official HTML...");
  const htmlStartedAt = Date.now();
  let htmlDocument = "";
  try {
    htmlDocument = await fetchTextHtml(input);
  } catch (error) {
    throw new ProvisionIngestError(
      `Failed to fetch official HTML source required for reliable provisions: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  const htmlFetchMs = Date.now() - htmlStartedAt;

  if (htmlDocument.trim().length === 0) {
    throw new ProvisionIngestError(
      "Official text.html source is empty; refusing to invent provision text.",
    );
  }

  reportProgress("Parsing structure and extracting provisions...");
  const extractStartedAt = Date.now();
  const extraction = await extractProvisionDraftsFromStructure(normalizedTree, {
    htmlDocument,
    fetchFragmentHtml: enableFragmentFallback
      ? async (treeId) => fetchTextHtmlFragment(input, treeId)
      : undefined,
    fragmentFallback: enableFragmentFallback
      ? {
          maxRequests: fragmentFallbackMaxRequests,
          concurrency: fragmentFallbackConcurrency,
        }
      : undefined,
    onNodeProcessed: ({ extractedProvisions, totalNodes }) => {
      if (extractedProvisions > 0 && extractedProvisions % 100 === 0) {
        reportProgress(`Extracted ${extractedProvisions}/${totalNodes}...`);
      }
    },
    onFallbackRequest: ({ requested, total }) => {
      reportProgress(`Fragment fallback ${requested}/${total}...`);
    },
  }).catch((error) => {
    if (error instanceof ProvisionExtractionError) {
      throw new ProvisionIngestError(error.message);
    }

    throw error;
  });

  reportProgress(`Persisting ${extraction.provisions.length} provisions...`);
  const persistStartedAt = Date.now();

  const transactionResult = await db.transaction(async (tx) => {
    const actPayload = mapEliMetadataToLegalAct(metadata);

    const existingAct = (
      await tx
        .select()
        .from(legalActs)
        .where(and(eq(legalActs.source, ELI_SOURCE), eq(legalActs.sourceId, sourceId)))
        .limit(1)
    )[0];

    let legalActId: string;
    let legalActAction: IngestProvisionsResult["legalActAction"];

    if (!existingAct) {
      const inserted = await tx.insert(legalActs).values(actPayload).returning({ id: legalActs.id });
      legalActId = inserted[0].id;
      legalActAction = "inserted";
    } else if (!areActFieldsEqual(existingAct, actPayload)) {
      const updated = await tx
        .update(legalActs)
        .set({
          ...actPayload,
          updatedAt: now,
        })
        .where(eq(legalActs.id, existingAct.id))
        .returning({ id: legalActs.id });
      legalActId = updated[0].id;
      legalActAction = "updated";
    } else {
      legalActId = existingAct.id;
      legalActAction = "unchanged";
    }

    let legalActVersionId = args.legalActVersionId ?? null;
    let versionAction: IngestProvisionsResult["versionAction"] = "existing";

    if (legalActVersionId) {
      const existingVersion = (
        await tx
          .select()
          .from(legalActVersions)
          .where(
            and(
              eq(legalActVersions.id, legalActVersionId),
              eq(legalActVersions.legalActId, legalActId),
            ),
          )
          .limit(1)
      )[0];

      if (!existingVersion) {
        throw new ProvisionIngestError(
          `Target legal act version ${legalActVersionId} does not exist for ${sourceId}`,
        );
      }

      if (existingVersion.versionKind === "promulgated" && existingVersion.isCurrent) {
        throw new ProvisionIngestError(
          "Guard triggered: refusing provision ingestion into promulgated version marked as current.",
        );
      }
    } else {
      const sourceExpressionId = args.sourceExpressionId;
      if (!sourceExpressionId) {
        throw new ProvisionIngestError("Missing --source-expression-id");
      }

      const existingByExpression = (
        await tx
          .select()
          .from(legalActVersions)
          .where(
            and(
              eq(legalActVersions.legalActId, legalActId),
              eq(legalActVersions.sourceExpressionId, sourceExpressionId),
            ),
          )
          .limit(1)
      )[0];

      if (existingByExpression) {
        legalActVersionId = existingByExpression.id;
      } else {
        const versionKind: LegalActVersionKind = args.versionKind ?? "unknown";
        const authorityClass = classifyExpressionAuthority(versionKind);

        const created = await tx
          .insert(legalActVersions)
          .values({
            legalActId,
            versionKind,
            legalStateDate: metadata.legalStatusDate ?? null,
            effectiveFrom: metadata.validFrom ?? metadata.entryIntoForce ?? null,
            effectiveTo: null,
            sourceExpressionId,
            canonicalEliUri: null,
            authorityClass,
            nonAuthoritative: authorityClass === "non_authoritative",
            currentnessStatus: "unproven",
            sourceDocumentKey: `provisions_source_expression:${sourceExpressionId}`,
            sourceUpdatedAt: metadata.changeDate ? new Date(metadata.changeDate) : null,
            contentHash: null,
            sourceHtmlUrl: buildActApiUrl(input, ELI_API_BASE_URL) + "/text.html",
            sourcePdfUrl: null,
            sourceUnifiedPdfUrl: null,
            isCurrent: false,
          })
          .returning({ id: legalActVersions.id });

        legalActVersionId = created[0].id;
        versionAction = "created";
      }
    }

    if (!legalActVersionId) {
      throw new ProvisionIngestError("Failed to resolve target legal act version");
    }

    const existingProvisions = await tx
      .select()
      .from(legalProvisions)
      .where(eq(legalProvisions.legalActVersionId, legalActVersionId));

    const existingByPath = new Map(existingProvisions.map((row) => [row.structuralPath, row]));
    const stalePathIds = new Set(existingProvisions.map((row) => row.id));
    const idByPath = new Map<string, string>();

    const counters = {
      inserted: 0,
      updated: 0,
      unchanged: 0,
      deleted: 0,
    };

    for (const draft of extraction.provisions) {
      const parentProvisionId = draft.parentStructuralPath
        ? (idByPath.get(draft.parentStructuralPath) ?? existingByPath.get(draft.parentStructuralPath)?.id ?? null)
        : null;

      if (draft.parentStructuralPath && !parentProvisionId) {
        throw new ProvisionIngestError(
          `Cannot resolve parent provision for ${draft.structuralPath} (${draft.parentStructuralPath})`,
        );
      }

      const payload: typeof legalProvisions.$inferInsert = {
        legalActVersionId,
        parentProvisionId,
        provisionType: draft.provisionType,
        article: draft.article,
        paragraph: draft.paragraph,
        point: draft.point,
        letter: draft.letter,
        citationLabel: draft.citationLabel,
        heading: draft.heading,
        text: draft.text,
        structuralPath: draft.structuralPath,
        ordinal: draft.ordinal,
      };

      const existing = existingByPath.get(draft.structuralPath);

      if (!existing) {
        if (!args.dryRun) {
          const inserted = await tx
            .insert(legalProvisions)
            .values(payload)
            .returning({ id: legalProvisions.id });
          idByPath.set(draft.structuralPath, inserted[0].id);
        }
        counters.inserted += 1;
        continue;
      }

      stalePathIds.delete(existing.id);
      idByPath.set(draft.structuralPath, existing.id);

      if (areProvisionFieldsEqual(existing, payload)) {
        counters.unchanged += 1;
        continue;
      }

      if (!args.dryRun) {
        await tx
          .update(legalProvisions)
          .set({
            ...payload,
            updatedAt: now,
          })
          .where(eq(legalProvisions.id, existing.id));
      }

      counters.updated += 1;
    }

    if (stalePathIds.size > 0) {
      counters.deleted = stalePathIds.size;
      if (!args.dryRun) {
        await tx.delete(legalProvisions).where(inArray(legalProvisions.id, [...stalePathIds]));
      }
    }

    if (!args.dryRun) {
      const desiredPaths = extraction.provisions.map((item) => item.structuralPath);
      if (desiredPaths.length > 0) {
        await tx
          .delete(legalProvisions)
          .where(
            and(
              eq(legalProvisions.legalActVersionId, legalActVersionId),
              notInArray(legalProvisions.structuralPath, desiredPaths),
            ),
          );
      }
    }

    return {
      sourceId,
      legalActVersionId,
      legalActAction,
      versionAction,
      provisions: {
        ...counters,
        total: extraction.provisions.length,
      },
      stats: extraction.stats,
    };
  });

  const extractMs = Date.now() - extractStartedAt;
  const persistMs = Date.now() - persistStartedAt;
  reportProgress("Done.");

  return {
    ...transactionResult,
    timingsMs: {
      metadataFetch: metadataFetchMs,
      structFetch: structFetchMs,
      htmlFetch: htmlFetchMs,
      extract: extractMs,
      persist: persistMs,
      total: Date.now() - startedAt,
    },
  };
}