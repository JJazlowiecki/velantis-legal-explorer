import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	boolean,
	date,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	vector,
} from "drizzle-orm/pg-core";

export const legalActs = pgTable(
	"legal_acts",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		jurisdiction: text("jurisdiction").notNull(),
		source: text("source").notNull(),
		sourceId: text("source_id").notNull(),
		title: text("title").notNull(),
		actType: text("act_type").notNull(),
		publisher: text("publisher"),
		journalYear: integer("journal_year"),
		journalPosition: integer("journal_position"),
		announcementDate: date("announcement_date"),
		promulgationDate: date("promulgation_date"),
		entryIntoForceDate: date("entry_into_force_date"),
		expirationDate: date("expiration_date"),
		status: text("status"),
		inForce: boolean("in_force"),
		eliUri: text("eli_uri"),
		officialPageUrl: text("official_page_url"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("legal_acts_source_source_id_uidx").on(table.source, table.sourceId),
		index("legal_acts_jurisdiction_idx").on(table.jurisdiction),
		index("legal_acts_source_idx").on(table.source),
		index("legal_acts_in_force_idx").on(table.inForce),
	],
);

export const legalActVersions = pgTable(
	"legal_act_versions",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		legalActId: uuid("legal_act_id")
			.notNull()
			.references(() => legalActs.id, { onDelete: "cascade" }),
		versionKind: text("version_kind").notNull(),
		legalStateDate: date("legal_state_date"),
		effectiveFrom: date("effective_from"),
		effectiveTo: date("effective_to"),
		sourceExpressionId: text("source_expression_id").notNull().default("unknown"),
		/**
		 * Immutable-instance identity for an announcement-backed consolidated (tj) version — the
		 * `legal_acts` row of the OFFICIAL "Obwieszczenie ... w sprawie ogłoszenia jednolitego
		 * tekstu ustawy" that this version's provisions were extracted from. NULL for every other
		 * version (ogl, uj, and the legacy pre-announcement-model bare `tj` reachability row).
		 * Deliberately real relational provenance rather than a denormalized ELI string: the
		 * announcement's own `legal_acts.sourceId`/`eliUri` already carries that identity, and a
		 * copy here would just be one more place for it to drift out of sync.
		 */
		sourceAnnouncementLegalActId: uuid("source_announcement_legal_act_id").references(
			(): AnyPgColumn => legalActs.id,
			{ onDelete: "restrict" },
		),
		canonicalEliUri: text("canonical_eli_uri"),
		authorityClass: text("authority_class").notNull().default("unknown"),
		nonAuthoritative: boolean("non_authoritative").notNull().default(false),
		currentnessStatus: text("currentness_status").notNull().default("unproven"),
		sourceDocumentKey: text("source_document_key").notNull(),
		sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
		fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
		contentHash: text("content_hash"),
		sourceHtmlUrl: text("source_html_url"),
		sourcePdfUrl: text("source_pdf_url"),
		sourceUnifiedPdfUrl: text("source_unified_pdf_url"),
		isCurrent: boolean("is_current").default(false).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("legal_act_versions_legal_act_id_idx").on(table.legalActId),
		index("legal_act_versions_version_kind_idx").on(table.versionKind),
		index("legal_act_versions_is_current_idx").on(table.isCurrent),
		index("legal_act_versions_source_announcement_legal_act_id_idx").on(
			table.sourceAnnouncementLegalActId,
		),
		// Legacy/non-announcement expression slots (ogl, uj, and the pre-announcement-model bare
		// `tj` reachability row) stay a singleton per (act, expression kind) — unchanged behavior.
		// Announcement-backed consolidated versions are exempt from this constraint: many
		// immutable `tj` versions (one per historical announcement) may coexist for one base act.
		uniqueIndex("legal_act_versions_source_expression_uidx")
			.on(table.legalActId, table.sourceExpressionId)
			.where(sql`${table.sourceAnnouncementLegalActId} IS NULL`),
		// Announcement-backed versions: at most one version per (base act, announcement) — makes
		// re-ingesting the SAME announcement idempotent while still allowing one new immutable
		// version per DISTINCT announcement.
		uniqueIndex("legal_act_versions_source_announcement_uidx")
			.on(table.legalActId, table.sourceAnnouncementLegalActId)
			.where(sql`${table.sourceAnnouncementLegalActId} IS NOT NULL`),
		uniqueIndex("legal_act_versions_source_document_uidx").on(
			table.legalActId,
			table.sourceDocumentKey,
		),
	],
);

/**
 * Normalized ELI `/references` relation graph for a legal act — persisted so future current-law
 * classification can run purely from DB state, never a live ELI call (see
 * feature/current-law-corpus Phase 1). `relationType` is OUR stable internal vocabulary (derived
 * from, but decoupled from, the Polish `sourceRelationType` label actually returned by ELI) so a
 * label wording change upstream can't silently break classification logic. An unrecognized label
 * is preserved as `relationType = "unrecognized"` (never dropped, never crashes ingestion) with
 * `sourceRelationType` kept for audit — it is simply never consulted by classification.
 * `relatedLegalActId` is nullable BY DESIGN: a relation is recorded as soon as it's discovered,
 * even before the related act's own metadata has been fetched/ingested, so classification can
 * fail closed on "related act not yet resolved" instead of silently fabricating one.
 *
 * `isActive`/`refreshedAt` give this an explicit current-vs-historical observation state (row
 * identity itself is NEVER deleted, per (legalActId, relationType, relatedSourceId) — a relation
 * that disappears from a later successful ELI response is marked inactive, not removed, so
 * historical provenance survives while future classification can safely filter to `isActive`
 * only. `refreshedAt` doubles as "last seen active": it only ever advances while a relation is
 * (re)confirmed active — it is deliberately NOT touched at the moment a relation is deactivated,
 * so it always answers "when was this last actually observed," not "when did we last run a sync."
 */
export const legalActRelations = pgTable(
	"legal_act_relations",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		legalActId: uuid("legal_act_id")
			.notNull()
			.references(() => legalActs.id, { onDelete: "cascade" }),
		relationType: text("relation_type").notNull(),
		sourceRelationType: text("source_relation_type").notNull(),
		relatedSourceId: text("related_source_id").notNull(),
		relatedLegalActId: uuid("related_legal_act_id").references(() => legalActs.id, {
			onDelete: "set null",
		}),
		isActive: boolean("is_active").notNull().default(true),
		discoveredAt: timestamp("discovered_at", { withTimezone: true }).defaultNow().notNull(),
		refreshedAt: timestamp("refreshed_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("legal_act_relations_legal_act_id_idx").on(table.legalActId),
		index("legal_act_relations_related_legal_act_id_idx").on(table.relatedLegalActId),
		index("legal_act_relations_relation_type_idx").on(table.relationType),
		index("legal_act_relations_is_active_idx").on(table.isActive),
		uniqueIndex("legal_act_relations_identity_uidx").on(
			table.legalActId,
			table.relationType,
			table.relatedSourceId,
		),
	],
);

export const legalActResources = pgTable(
	"legal_act_resources",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		legalActId: uuid("legal_act_id")
			.notNull()
			.references(() => legalActs.id, { onDelete: "cascade" }),
		legalActVersionId: uuid("legal_act_version_id").references(() => legalActVersions.id, {
			onDelete: "set null",
		}),
		sourceTypeCodes: text("source_type_codes").notNull(),
		representationType: text("representation_type").notNull(),
		fileName: text("file_name").notNull(),
		sourceUrl: text("source_url").notNull(),
		contentHash: text("content_hash"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("legal_act_resources_legal_act_id_idx").on(table.legalActId),
		index("legal_act_resources_legal_act_version_id_idx").on(table.legalActVersionId),
		index("legal_act_resources_representation_type_idx").on(table.representationType),
		uniqueIndex("legal_act_resources_source_url_uidx").on(table.legalActId, table.sourceUrl),
	],
);

export const legalProvisions = pgTable(
	"legal_provisions",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		legalActVersionId: uuid("legal_act_version_id")
			.notNull()
			.references(() => legalActVersions.id, { onDelete: "cascade" }),
		parentProvisionId: uuid("parent_provision_id").references(
			(): AnyPgColumn => legalProvisions.id,
			{
				onDelete: "cascade",
			},
		),
		provisionType: text("provision_type").notNull(),
		article: text("article"),
		paragraph: text("paragraph"),
		point: text("point"),
		letter: text("letter"),
		citationLabel: text("citation_label").notNull(),
		heading: text("heading"),
		text: text("text").notNull(),
		structuralPath: text("structural_path").notNull(),
		ordinal: integer("ordinal").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("legal_provisions_legal_act_version_id_idx").on(table.legalActVersionId),
		index("legal_provisions_parent_provision_id_idx").on(table.parentProvisionId),
		index("legal_provisions_citation_label_idx").on(table.citationLabel),
		uniqueIndex("legal_provisions_structural_path_uidx").on(
			table.legalActVersionId,
			table.structuralPath,
		),
		uniqueIndex("legal_provisions_ordinal_uidx").on(table.legalActVersionId, table.ordinal),
	],
);

export const legalSearchDocuments = pgTable(
	"legal_search_documents",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		legalProvisionId: uuid("legal_provision_id")
			.notNull()
			.references(() => legalProvisions.id, { onDelete: "cascade" }),
		legalActVersionId: uuid("legal_act_version_id")
			.notNull()
			.references(() => legalActVersions.id, { onDelete: "cascade" }),
		content: text("content").notNull(),
		contentHash: text("content_hash").notNull(),
		embedding: vector("embedding", { dimensions: 1536 }),
		embeddingModel: text("embedding_model"),
		embeddedAt: timestamp("embedded_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("legal_search_documents_legal_provision_id_uidx").on(table.legalProvisionId),
		index("legal_search_documents_legal_act_version_id_idx").on(table.legalActVersionId),
	],
);

/**
 * Real persisted /explorer search history, scoped by an anonymous `visitor_id` (an
 * HttpOnly-cookie-backed UUID — see src/lib/explorer/history/visitor.ts). No `user_id`/auth
 * exists yet; `visitor_id` is deliberately a plain UUID column (not a foreign key) so a future
 * authenticated `user_id` can be introduced or absorb anonymous ownership without reshaping
 * this table. `resultSnapshot` is a Zod-validated sanitized view model (see
 * src/lib/explorer/history/snapshot.ts) — never raw OpenAI responses, embeddings, prompts, or
 * SOURCE_X placeholders.
 */
export const explorerHistoryEntries = pgTable(
	"explorer_history_entries",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		visitorId: uuid("visitor_id").notNull(),
		query: text("query").notNull(),
		status: text("status").notNull(),
		resultSnapshot: jsonb("result_snapshot").notNull(),
		corpusVersionIds: jsonb("corpus_version_ids").notNull(),
		/**
		 * Current-law-corpus provenance (see current_law_corpus_runs below) — null for entries
		 * recorded in the historical test corpus mode. Real FK with onDelete:"restrict": a corpus
		 * run is an immutable audit record that must never be silently orphaned by deleting it out
		 * from under a History entry that cites it.
		 */
		corpusRunId: uuid("corpus_run_id").references((): AnyPgColumn => currentLawCorpusRuns.id, {
			onDelete: "restrict",
		}),
		rulesetVersion: text("ruleset_version"),
		effectiveAsOf: date("effective_as_of"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("explorer_history_entries_visitor_id_created_at_idx").on(table.visitorId, table.createdAt),
	],
);

/**
 * Real persisted /explorer Saved folders, scoped by the same anonymous `visitor_id` as
 * History (see src/lib/explorer/history/visitor.ts) — deliberately the same ownership
 * mechanism, not a second identity. No nested folders in this milestone. Case-insensitive
 * duplicate-name rejection and the folder-count limit are enforced in service logic
 * (src/lib/explorer/saved/service.ts), not via a DB constraint, to keep this migration simple.
 */
export const explorerSavedFolders = pgTable(
	"explorer_saved_folders",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		visitorId: uuid("visitor_id").notNull(),
		name: text("name").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index("explorer_saved_folders_visitor_id_idx").on(table.visitorId)],
);

/**
 * Real persisted /explorer Saved items — answers, searches, and individual provisions. Each
 * row carries its OWN validated, sanitized snapshot (see src/lib/explorer/saved/snapshot.ts);
 * it never depends on a History row surviving forever (History may later gain retention/
 * deletion). `folderId` is nullable and `onDelete: "set null"` so deleting a folder unfiles
 * its items instead of deleting them. `contentKey` is a deterministic per-kind fingerprint
 * (src/lib/explorer/saved/content-key.ts) used for duplicate-save detection: unique per
 * visitor+kind+contentKey, enforced by the DB as the final safety net alongside the
 * application-level advisory-lock transaction that also enforces quota (see service.ts).
 */
export const explorerSavedItems = pgTable(
	"explorer_saved_items",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		visitorId: uuid("visitor_id").notNull(),
		folderId: uuid("folder_id").references(() => explorerSavedFolders.id, { onDelete: "set null" }),
		kind: text("kind").notNull(),
		title: text("title").notNull(),
		query: text("query"),
		contentKey: text("content_key").notNull(),
		snapshot: jsonb("snapshot").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("explorer_saved_items_visitor_id_created_at_idx").on(table.visitorId, table.createdAt),
		index("explorer_saved_items_visitor_id_folder_id_idx").on(table.visitorId, table.folderId),
		uniqueIndex("explorer_saved_items_visitor_kind_content_key_uidx").on(
			table.visitorId,
			table.kind,
			table.contentKey,
		),
	],
);

/**
 * One immutable, auditable "was this base act's text safe to treat as current law as of
 * effectiveAsOf, under rulesetVersion, and why" decision batch (see
 * src/lib/legal/current-law/select.ts and service.ts, feature/current-corpus-runtime
 * milestone). A run is never mutated or deleted after creation — regenerating always inserts
 * a NEW row; old runs stay queryable forever for audit. `currentnessStatus`/`isCurrent` on
 * legal_act_versions are deliberately NEVER written by this pipeline — currentness is
 * entirely run/effectiveAsOf-relative and lives only here and in current_law_corpus_entries.
 */
export const currentLawCorpusRuns = pgTable(
	"current_law_corpus_runs",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		effectiveAsOf: date("effective_as_of").notNull(),
		generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
		rulesetVersion: text("ruleset_version").notNull(),
		selectionHash: text("selection_hash").notNull(),
		status: text("status").notNull(),
		summary: jsonb("summary").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("current_law_corpus_runs_ruleset_version_idx").on(table.rulesetVersion),
		index("current_law_corpus_runs_effective_as_of_idx").on(table.effectiveAsOf),
		index("current_law_corpus_runs_ruleset_status_generated_idx").on(
			table.rulesetVersion,
			table.status,
			table.generatedAt,
		),
	],
);

/**
 * One per-base-act decision within a current_law_corpus_runs run — records BOTH included and
 * excluded acts, with an explicit machine-testable reasonCode (see reason-codes.ts) and a
 * JSON evidence trail. `legalActVersionId` is null for excluded acts with no qualifying
 * version. `runtimeReady` is orthogonal to `decision`: an act can be legally `included` by
 * Model A yet not yet indexed/embedded — see indexing readiness logic in service.ts.
 */
export const currentLawCorpusEntries = pgTable(
	"current_law_corpus_entries",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		runId: uuid("run_id")
			.notNull()
			.references(() => currentLawCorpusRuns.id, { onDelete: "cascade" }),
		legalActId: uuid("legal_act_id")
			.notNull()
			.references(() => legalActs.id, { onDelete: "restrict" }),
		legalActVersionId: uuid("legal_act_version_id").references(() => legalActVersions.id, {
			onDelete: "restrict",
		}),
		decision: text("decision").notNull(),
		reasonCode: text("reason_code").notNull(),
		evidence: jsonb("evidence").notNull(),
		runtimeReady: boolean("runtime_ready").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("current_law_corpus_entries_run_id_idx").on(table.runId),
		index("current_law_corpus_entries_decision_idx").on(table.decision),
		uniqueIndex("current_law_corpus_entries_run_act_uidx").on(table.runId, table.legalActId),
	],
);
