CREATE TABLE "legal_act_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_act_id" uuid NOT NULL,
	"version_kind" text NOT NULL,
	"legal_state_date" date,
	"effective_from" date,
	"effective_to" date,
	"source_updated_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" text,
	"source_html_url" text,
	"source_pdf_url" text,
	"source_unified_pdf_url" text,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_acts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction" text NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"title" text NOT NULL,
	"act_type" text NOT NULL,
	"publisher" text,
	"journal_year" integer,
	"journal_position" integer,
	"announcement_date" date,
	"promulgation_date" date,
	"entry_into_force_date" date,
	"expiration_date" date,
	"status" text,
	"in_force" boolean,
	"eli_uri" text,
	"official_page_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_provisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_act_version_id" uuid NOT NULL,
	"parent_provision_id" uuid,
	"provision_type" text NOT NULL,
	"article" text,
	"paragraph" text,
	"point" text,
	"letter" text,
	"citation_label" text NOT NULL,
	"heading" text,
	"text" text NOT NULL,
	"structural_path" text NOT NULL,
	"ordinal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legal_act_versions" ADD CONSTRAINT "legal_act_versions_legal_act_id_legal_acts_id_fk" FOREIGN KEY ("legal_act_id") REFERENCES "public"."legal_acts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_provisions" ADD CONSTRAINT "legal_provisions_legal_act_version_id_legal_act_versions_id_fk" FOREIGN KEY ("legal_act_version_id") REFERENCES "public"."legal_act_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_provisions" ADD CONSTRAINT "legal_provisions_parent_provision_id_legal_provisions_id_fk" FOREIGN KEY ("parent_provision_id") REFERENCES "public"."legal_provisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legal_act_versions_legal_act_id_idx" ON "legal_act_versions" USING btree ("legal_act_id");--> statement-breakpoint
CREATE INDEX "legal_act_versions_version_kind_idx" ON "legal_act_versions" USING btree ("version_kind");--> statement-breakpoint
CREATE INDEX "legal_act_versions_is_current_idx" ON "legal_act_versions" USING btree ("is_current");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_act_versions_dedup_uidx" ON "legal_act_versions" USING btree ("legal_act_id","version_kind","legal_state_date","effective_from","effective_to","content_hash","source_html_url","source_pdf_url","source_unified_pdf_url");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_acts_source_source_id_uidx" ON "legal_acts" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "legal_acts_jurisdiction_idx" ON "legal_acts" USING btree ("jurisdiction");--> statement-breakpoint
CREATE INDEX "legal_acts_source_idx" ON "legal_acts" USING btree ("source");--> statement-breakpoint
CREATE INDEX "legal_acts_in_force_idx" ON "legal_acts" USING btree ("in_force");--> statement-breakpoint
CREATE INDEX "legal_provisions_legal_act_version_id_idx" ON "legal_provisions" USING btree ("legal_act_version_id");--> statement-breakpoint
CREATE INDEX "legal_provisions_parent_provision_id_idx" ON "legal_provisions" USING btree ("parent_provision_id");--> statement-breakpoint
CREATE INDEX "legal_provisions_citation_label_idx" ON "legal_provisions" USING btree ("citation_label");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_provisions_structural_path_uidx" ON "legal_provisions" USING btree ("legal_act_version_id","structural_path");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_provisions_ordinal_uidx" ON "legal_provisions" USING btree ("legal_act_version_id","ordinal");