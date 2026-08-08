CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE TABLE "legal_search_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_provision_id" uuid NOT NULL,
	"legal_act_version_id" uuid NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(1536),
	"embedding_model" text,
	"embedded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legal_search_documents" ADD CONSTRAINT "legal_search_documents_legal_provision_id_legal_provisions_id_fk" FOREIGN KEY ("legal_provision_id") REFERENCES "public"."legal_provisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_search_documents" ADD CONSTRAINT "legal_search_documents_legal_act_version_id_legal_act_versions_id_fk" FOREIGN KEY ("legal_act_version_id") REFERENCES "public"."legal_act_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_search_documents_legal_provision_id_uidx" ON "legal_search_documents" USING btree ("legal_provision_id");--> statement-breakpoint
CREATE INDEX "legal_search_documents_legal_act_version_id_idx" ON "legal_search_documents" USING btree ("legal_act_version_id");