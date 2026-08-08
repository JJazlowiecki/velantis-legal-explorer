ALTER TABLE "legal_act_versions" ADD COLUMN "source_expression_id" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "legal_act_versions" ADD COLUMN "canonical_eli_uri" text;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_act_versions_source_expression_uidx" ON "legal_act_versions" USING btree ("legal_act_id","source_expression_id");