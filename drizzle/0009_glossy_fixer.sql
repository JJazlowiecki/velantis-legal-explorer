CREATE TABLE "legal_act_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_act_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"source_relation_type" text NOT NULL,
	"related_source_id" text NOT NULL,
	"related_legal_act_id" uuid,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "legal_act_versions_source_expression_uidx";--> statement-breakpoint
ALTER TABLE "legal_act_versions" ADD COLUMN "source_announcement_legal_act_id" uuid;--> statement-breakpoint
ALTER TABLE "legal_act_relations" ADD CONSTRAINT "legal_act_relations_legal_act_id_legal_acts_id_fk" FOREIGN KEY ("legal_act_id") REFERENCES "public"."legal_acts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_act_relations" ADD CONSTRAINT "legal_act_relations_related_legal_act_id_legal_acts_id_fk" FOREIGN KEY ("related_legal_act_id") REFERENCES "public"."legal_acts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legal_act_relations_legal_act_id_idx" ON "legal_act_relations" USING btree ("legal_act_id");--> statement-breakpoint
CREATE INDEX "legal_act_relations_related_legal_act_id_idx" ON "legal_act_relations" USING btree ("related_legal_act_id");--> statement-breakpoint
CREATE INDEX "legal_act_relations_relation_type_idx" ON "legal_act_relations" USING btree ("relation_type");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_act_relations_identity_uidx" ON "legal_act_relations" USING btree ("legal_act_id","relation_type","related_source_id");--> statement-breakpoint
ALTER TABLE "legal_act_versions" ADD CONSTRAINT "legal_act_versions_source_announcement_legal_act_id_legal_acts_id_fk" FOREIGN KEY ("source_announcement_legal_act_id") REFERENCES "public"."legal_acts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legal_act_versions_source_announcement_legal_act_id_idx" ON "legal_act_versions" USING btree ("source_announcement_legal_act_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_act_versions_source_announcement_uidx" ON "legal_act_versions" USING btree ("legal_act_id","source_announcement_legal_act_id") WHERE "legal_act_versions"."source_announcement_legal_act_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_act_versions_source_expression_uidx" ON "legal_act_versions" USING btree ("legal_act_id","source_expression_id") WHERE "legal_act_versions"."source_announcement_legal_act_id" IS NULL;