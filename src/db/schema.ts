import {
	type AnyPgColumn,
	boolean,
	date,
	index,
	integer,
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
		uniqueIndex("legal_act_versions_source_expression_uidx").on(
			table.legalActId,
			table.sourceExpressionId,
		),
		uniqueIndex("legal_act_versions_source_document_uidx").on(
			table.legalActId,
			table.sourceDocumentKey,
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
