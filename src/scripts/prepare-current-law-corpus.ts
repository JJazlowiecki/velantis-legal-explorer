import { config as loadEnv } from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../db/schema";
import { legalActRelations, legalActs } from "../db/schema";
import { CURRENT_LAW_BOOTSTRAP_SCOPE } from "../lib/legal/current-law/bootstrap-scope";
import { fetchEliActMetadata, fetchEliActReferences } from "../lib/legal/eli/client";
import { ConsolidatedIngestError, ingestOfficialConsolidatedStructure } from "../lib/legal/eli/consolidated-ingest";
import { ingestEliActMetadata } from "../lib/legal/eli/ingest";
import { resolveLatestAnnouncementSourceId } from "../lib/legal/eli/latest-announcement";
import { ELI_SOURCE } from "../lib/legal/eli/schema";
import { ingestOfficialConsolidatedPdf, PdfConsolidatedIngestError } from "../lib/legal/pdf/pdf-ingest";
import { indexLegalSearchDocuments } from "../lib/legal/search/indexing";
import { parseServerEnv } from "../lib/env/schema";

function parseSourceId(sourceId: string): { publisher: string; year: number; position: number } {
	const [publisher, yearStr, positionStr] = sourceId.split("/");
	const year = Number(yearStr);
	const position = Number(positionStr);
	if (!publisher || !Number.isInteger(year) || !Number.isInteger(position)) {
		throw new Error(`Invalid sourceId "${sourceId}", expected e.g. "DU/1964/93"`);
	}
	return { publisher, year, position };
}

function printUsage() {
	console.error("Usage: pnpm corpus:prepare [--only <sourceId>] [--current-only]");
}

async function main() {
	loadEnv({ path: ".env" });
	const env = parseServerEnv(process.env);
	const client = postgres(env.DATABASE_URL, { max: 1 });
	const db = drizzle({ client, schema });

	try {
		const argv = process.argv.slice(2);
		let only: string | undefined;
		let currentOnly = false;
		for (let i = 0; i < argv.length; i += 1) {
			if (argv[i] === "--only") {
				only = argv[i + 1];
				i += 1;
			} else if (argv[i] === "--current-only") {
				currentOnly = true;
			}
		}

		const scope = only ? CURRENT_LAW_BOOTSTRAP_SCOPE.filter((e) => e.sourceId === only) : CURRENT_LAW_BOOTSTRAP_SCOPE;
		if (scope.length === 0) {
			printUsage();
			throw new Error(only ? `"${only}" is not in the bootstrap scope` : "Bootstrap scope is empty");
		}

		const versionsToIndex = new Set<string>();
		const actOutcomes: string[] = [];

		for (const scopeEntry of scope) {
			console.log(`\n=== ${scopeEntry.sourceId} (${scopeEntry.label}) ===`);
			try {
				const coords = parseSourceId(scopeEntry.sourceId);
				await ingestEliActMetadata(coords, { fetchReferences: fetchEliActReferences, db });
				console.log(`base metadata + relations synced`);

				const [baseAct] = await db
					.select({ id: legalActs.id })
					.from(legalActs)
					.where(and(eq(legalActs.source, ELI_SOURCE), eq(legalActs.sourceId, scopeEntry.sourceId)))
					.limit(1);
				if (!baseAct) {
					console.log(`base act row not found after ingest, skipping`);
					continue;
				}

				const announcementChain = await db
					.select({ relatedSourceId: legalActRelations.relatedSourceId })
					.from(legalActRelations)
					.where(
						and(
							eq(legalActRelations.legalActId, baseAct.id),
							eq(legalActRelations.isActive, true),
							eq(legalActRelations.relationType, "consolidated_text_announcement"),
						),
					);
				console.log(`announcement chain: ${announcementChain.length} entr${announcementChain.length === 1 ? "y" : "ies"}`);

				// --current-only: resolve which single announcement is the most-recently-promulgated
				// one via a plain metadata fetch (see resolveLatestAnnouncementSourceId) BEFORE the
				// main loop, then skip structure/index ingestion for every other chain entry below.
				// `structureTargetSourceId === undefined` means "prepare the whole chain" (default
				// behavior, byte-for-byte unchanged) — current-only is opt-in. Resolution fails
				// CLOSED: any single unresolved chain entry (fetch failure or missing/unusable
				// promulgation date) throws and aborts this act entirely (caught by the per-act
				// try/catch below) — it never falls back to full-chain ingestion and never selects
				// from a partially resolved chain.
				let structureTargetSourceId: string | undefined;
				if (currentOnly) {
					structureTargetSourceId = await resolveLatestAnnouncementSourceId(
						announcementChain.map((c) => c.relatedSourceId),
						fetchEliActMetadata,
						parseSourceId,
					);
					console.log(`--current-only: latest announcement is ${structureTargetSourceId} — structure/index ingestion limited to it`);
				}

				for (const chainEntry of announcementChain) {
					const announcementSourceId = chainEntry.relatedSourceId;
					const shouldIngestStructure = structureTargetSourceId === undefined || structureTargetSourceId === announcementSourceId;
					try {
						if (!shouldIngestStructure) {
							console.log(`  ${announcementSourceId}: skipped (--current-only, not the latest announcement)`);
						} else {
							// Generic resource-capability rule (Phase 9 — never act-ID-special-cased): the
							// announcement's own ELI metadata says which representation is actually
							// available for THIS exact announcement. Most acts still publish text.html and
							// take that (unchanged, historically-proven) path; an announcement with
							// textHTML=false falls back to the official PDF "T" attachment instead — same
							// provenance verification, same immutable-revision identity either way.
							const announcementCoords = (() => {
								const [publisher, yearStr, positionStr] = announcementSourceId.split("/");
								return { publisher, year: Number(yearStr), position: Number(positionStr) };
							})();
							const announcementMetadata = await fetchEliActMetadata(announcementCoords);

							if (announcementMetadata.textHTML) {
								const result = await ingestOfficialConsolidatedStructure({
									db,
									baseActSourceId: scopeEntry.sourceId,
									announcementActSourceId: announcementSourceId,
								});
								console.log(
									`  ${announcementSourceId}: structure OK via HTML (version=${result.legalActVersionId}, ${result.insertedCount} provisions)`,
								);
								versionsToIndex.add(result.legalActVersionId);
							} else if (announcementMetadata.textPDF) {
								const result = await ingestOfficialConsolidatedPdf({
									db,
									baseActSourceId: scopeEntry.sourceId,
									announcementActSourceId: announcementSourceId,
								});
								console.log(
									`  ${announcementSourceId}: structure OK via PDF (version=${result.legalActVersionId}, ${result.insertedCount} provisions, source=${result.sourcePdfUrl})`,
								);
								versionsToIndex.add(result.legalActVersionId);
							} else {
								console.log(`  ${announcementSourceId}: no HTML or PDF text available from official source — skipping`);
							}
						}
					} catch (error) {
						console.log(
							`  ${announcementSourceId}: structure ingest FAILED — ${error instanceof Error ? error.message : "unknown error"}`,
						);
					}

					// Per correction: sync the ANNOUNCEMENT's own relation graph regardless of whether
					// its structure ingestion above succeeded, so its post_consolidated_amendment
					// relations are correctly scoped to it (not the base act) for classification.
					try {
						const announcementCoords = parseSourceId(announcementSourceId);
						await ingestEliActMetadata(announcementCoords, { fetchReferences: fetchEliActReferences, db });

						const [announcementAct] = await db
							.select({ id: legalActs.id })
							.from(legalActs)
							.where(and(eq(legalActs.source, ELI_SOURCE), eq(legalActs.sourceId, announcementSourceId)))
							.limit(1);
						if (announcementAct) {
							const amendmentRelations = await db
								.select({ relatedSourceId: legalActRelations.relatedSourceId })
								.from(legalActRelations)
								.where(
									and(
										eq(legalActRelations.legalActId, announcementAct.id),
										eq(legalActRelations.isActive, true),
										eq(legalActRelations.relationType, "post_consolidated_amendment"),
									),
								);
							for (const amendment of amendmentRelations) {
								try {
									const amendmentCoords = parseSourceId(amendment.relatedSourceId);
									await ingestEliActMetadata(amendmentCoords, { db });
									console.log(`    amendment ${amendment.relatedSourceId}: metadata synced`);
								} catch (error) {
									console.log(
										`    amendment ${amendment.relatedSourceId}: metadata FAILED — ${error instanceof Error ? error.message : "unknown error"}`,
									);
								}
							}
						}
					} catch (error) {
						console.log(
							`  ${announcementSourceId}: relation sync FAILED — ${error instanceof Error ? error.message : "unknown error"}`,
						);
					}
				}

				// Sync metadata for the base act's own Constitutional Tribunal relation targets too —
				// select.ts needs each ruling's entryIntoForceDate to decide whether it is already
				// absorbed by the selected TJ's legalStateDate.
				const tkRelations = await db
					.select({ relatedSourceId: legalActRelations.relatedSourceId })
					.from(legalActRelations)
					.where(
						and(
							eq(legalActRelations.legalActId, baseAct.id),
							eq(legalActRelations.isActive, true),
							eq(legalActRelations.relationType, "constitutional_tribunal"),
						),
					);
				for (const tk of tkRelations) {
					try {
						const tkCoords = parseSourceId(tk.relatedSourceId);
						await ingestEliActMetadata(tkCoords, { db });
						console.log(`  TK ruling ${tk.relatedSourceId}: metadata synced`);
					} catch (error) {
						console.log(`  TK ruling ${tk.relatedSourceId}: metadata FAILED — ${error instanceof Error ? error.message : "unknown error"}`);
					}
				}

				// Re-sync the base act's OWN relations now that every announcement/amendment/TK act
				// referenced above has been ingested — relation resolution (relatedLegalActId) only
				// happens against whatever legal_acts rows exist AT SYNC TIME (see relations.ts), and
				// the first sync above ran before those related acts existed. Without this second
				// pass, every chain relation would be stuck with relatedLegalActId=null forever,
				// which select.ts correctly (but needlessly) treats as metadata_incomplete.
				await ingestEliActMetadata(coords, { fetchReferences: fetchEliActReferences, db });
				console.log(`base relations re-synced (resolving announcement/amendment/TK ids)`);

				actOutcomes.push(`${scopeEntry.sourceId}: prepared (${announcementChain.length} announcements known)`);
			} catch (error) {
				const message = error instanceof Error ? error.message : "unknown error";
				console.log(`FAILED: ${message}`);
				actOutcomes.push(`${scopeEntry.sourceId}: FAILED — ${message}`);
			}
		}

		console.log(`\n=== Indexing ${versionsToIndex.size} version(s) ===`);
		for (const versionId of versionsToIndex) {
			try {
				const result = await indexLegalSearchDocuments(versionId, { db });
				console.log(
					`  ${versionId}: indexed (${result.searchDocuments} docs, ${result.embedded} embedded, ${result.unchanged} unchanged)`,
				);
			} catch (error) {
				console.log(`  ${versionId}: indexing FAILED — ${error instanceof Error ? error.message : "unknown error"}`);
			}
		}

		console.log(`\n=== Summary ===`);
		for (const line of actOutcomes) console.log(line);
	} finally {
		await client.end({ timeout: 1 });
	}
}

main().catch((error: unknown) => {
	if (error instanceof ConsolidatedIngestError || error instanceof PdfConsolidatedIngestError) {
		console.error(`Preparation failed: ${error.message}`);
	} else if (error instanceof Error) {
		console.error(`Preparation failed: ${error.name}: ${error.message}`);
	} else {
		console.error("Preparation failed");
	}
	process.exitCode = 1;
});
