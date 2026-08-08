DROP INDEX "legal_act_versions_dedup_uidx";--> statement-breakpoint
ALTER TABLE "legal_act_versions" ADD COLUMN "source_document_key" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_act_versions_source_document_uidx" ON "legal_act_versions" USING btree ("legal_act_id","source_document_key");