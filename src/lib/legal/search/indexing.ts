import { and, eq, notInArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema";
import { legalActs, legalActVersions, legalProvisions, legalSearchDocuments } from "../../../db/schema";
import {
  buildSearchDocumentContent,
  hashSearchDocumentContent,
  isSearchableProvision,
} from "./documents";
import { embedTexts, type EmbedTextsFn } from "./embeddings";

const DEFAULT_EMBEDDING_BATCH_SIZE = 64;

export class SearchIndexingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchIndexingError";
  }
}

export interface IndexLegalSearchDocumentsOptions {
  db?: PostgresJsDatabase<typeof schema>;
  embedTexts?: EmbedTextsFn;
  embeddingModel?: string;
  batchSize?: number;
  now?: Date;
  onProgress?: (message: string) => void;
}

export interface IndexLegalSearchDocumentsResult {
  legalActVersionId: string;
  model: string;
  provisionsConsidered: number;
  searchDocuments: number;
  embedded: number;
  unchanged: number;
  removed: number;
}

interface ProvisionRow {
  id: string;
  parentProvisionId: string | null;
  provisionType: string;
  heading: string | null;
  text: string;
  citationLabel: string;
}

function resolveAncestorHeadings(
  provisionId: string | null,
  byId: Map<string, ProvisionRow>,
): string[] {
  const headings: string[] = [];
  let currentId = provisionId;
  const visited = new Set<string>();

  while (currentId) {
    if (visited.has(currentId)) {
      break;
    }
    visited.add(currentId);

    const provision = byId.get(currentId);
    if (!provision) {
      break;
    }

    headings.push(provision.heading ?? provision.citationLabel);
    currentId = provision.parentProvisionId;
  }

  return headings.reverse();
}

export async function indexLegalSearchDocuments(
  legalActVersionId: string,
  options: IndexLegalSearchDocumentsOptions = {},
): Promise<IndexLegalSearchDocumentsResult> {
  const now = options.now ?? new Date();
  const embeddingModel = options.embeddingModel ?? process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
  const batchSize = options.batchSize ?? DEFAULT_EMBEDDING_BATCH_SIZE;
  const embed = options.embedTexts ?? embedTexts;
  const reportProgress = options.onProgress ?? (() => undefined);

  const db = options.db ?? (await import("../../../db/script-db")).getScriptDb();

  const version = (
    await db
      .select({ id: legalActVersions.id, actTitle: legalActs.title })
      .from(legalActVersions)
      .innerJoin(legalActs, eq(legalActs.id, legalActVersions.legalActId))
      .where(eq(legalActVersions.id, legalActVersionId))
      .limit(1)
  )[0];

  if (!version) {
    throw new SearchIndexingError(`Legal act version ${legalActVersionId} does not exist`);
  }

  reportProgress("Reading provisions...");
  const provisionRows: ProvisionRow[] = await db
    .select({
      id: legalProvisions.id,
      parentProvisionId: legalProvisions.parentProvisionId,
      provisionType: legalProvisions.provisionType,
      heading: legalProvisions.heading,
      text: legalProvisions.text,
      citationLabel: legalProvisions.citationLabel,
    })
    .from(legalProvisions)
    .where(eq(legalProvisions.legalActVersionId, legalActVersionId));

  const byId = new Map(provisionRows.map((row) => [row.id, row]));

  const searchableRows = provisionRows.filter((row) => isSearchableProvision(row));

  const drafts = searchableRows.map((row) => {
    const ancestorHeadings = resolveAncestorHeadings(row.parentProvisionId, byId);
    const content = buildSearchDocumentContent({
      actTitle: version.actTitle,
      ancestorHeadings,
      citationLabel: row.citationLabel,
      text: row.text,
    });

    return {
      legalProvisionId: row.id,
      content,
      contentHash: hashSearchDocumentContent(content),
    };
  });

  reportProgress(`Diffing ${drafts.length} search documents...`);

  const existingDocs = await db
    .select({
      id: legalSearchDocuments.id,
      legalProvisionId: legalSearchDocuments.legalProvisionId,
      contentHash: legalSearchDocuments.contentHash,
    })
    .from(legalSearchDocuments)
    .where(eq(legalSearchDocuments.legalActVersionId, legalActVersionId));

  const existingByProvisionId = new Map(existingDocs.map((doc) => [doc.legalProvisionId, doc]));

  const toEmbed = drafts.filter((draft) => {
    const existing = existingByProvisionId.get(draft.legalProvisionId);
    return !existing || existing.contentHash !== draft.contentHash;
  });

  const unchangedCount = drafts.length - toEmbed.length;

  reportProgress(`Embedding ${toEmbed.length} documents...`);

  const embeddings: number[][] = [];
  for (let i = 0; i < toEmbed.length; i += batchSize) {
    const batch = toEmbed.slice(i, i + batchSize);
    const batchEmbeddings = await embed(
      batch.map((draft) => draft.content),
      { model: embeddingModel },
    );

    if (batchEmbeddings.length !== batch.length) {
      throw new SearchIndexingError(
        `Embedding provider returned ${batchEmbeddings.length} vectors for a batch of ${batch.length}`,
      );
    }

    embeddings.push(...batchEmbeddings);
    reportProgress(`Embedded ${Math.min(i + batchSize, toEmbed.length)}/${toEmbed.length}...`);
  }

  reportProgress("Persisting search documents...");

  await db.transaction(async (tx) => {
    for (let i = 0; i < toEmbed.length; i += 1) {
      const draft = toEmbed[i];
      const embedding = embeddings[i];
      const existing = existingByProvisionId.get(draft.legalProvisionId);

      if (existing) {
        await tx
          .update(legalSearchDocuments)
          .set({
            content: draft.content,
            contentHash: draft.contentHash,
            embedding,
            embeddingModel,
            embeddedAt: now,
            updatedAt: now,
          })
          .where(eq(legalSearchDocuments.id, existing.id));
      } else {
        await tx.insert(legalSearchDocuments).values({
          legalProvisionId: draft.legalProvisionId,
          legalActVersionId,
          content: draft.content,
          contentHash: draft.contentHash,
          embedding,
          embeddingModel,
          embeddedAt: now,
        });
      }
    }

    const desiredProvisionIds = drafts.map((draft) => draft.legalProvisionId);

    if (desiredProvisionIds.length > 0) {
      await tx
        .delete(legalSearchDocuments)
        .where(
          and(
            eq(legalSearchDocuments.legalActVersionId, legalActVersionId),
            notInArray(legalSearchDocuments.legalProvisionId, desiredProvisionIds),
          ),
        );
    } else {
      await tx
        .delete(legalSearchDocuments)
        .where(eq(legalSearchDocuments.legalActVersionId, legalActVersionId));
    }
  });

  const staleIds = existingDocs
    .filter((doc) => !drafts.some((draft) => draft.legalProvisionId === doc.legalProvisionId))
    .map((doc) => doc.id);

  return {
    legalActVersionId,
    model: embeddingModel,
    provisionsConsidered: provisionRows.length,
    searchDocuments: drafts.length,
    embedded: toEmbed.length,
    unchanged: unchangedCount,
    removed: staleIds.length,
  };
}
