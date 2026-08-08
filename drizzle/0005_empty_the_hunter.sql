ALTER TABLE "legal_act_resources" DROP CONSTRAINT "legal_act_resources_legal_act_version_id_legal_act_versions_id_fk";
--> statement-breakpoint
DROP INDEX "legal_act_resources_source_url_uidx";--> statement-breakpoint
ALTER TABLE "legal_act_resources" ALTER COLUMN "legal_act_version_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "legal_act_resources" ADD COLUMN "legal_act_id" uuid;--> statement-breakpoint
UPDATE "legal_act_resources" lar
SET "legal_act_id" = lav."legal_act_id"
FROM "legal_act_versions" lav
WHERE lar."legal_act_version_id" = lav."id";--> statement-breakpoint
ALTER TABLE "legal_act_resources" ALTER COLUMN "legal_act_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "legal_act_versions" ADD COLUMN "authority_class" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "legal_act_versions" ADD COLUMN "non_authoritative" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "legal_act_versions" ADD COLUMN "currentness_status" text DEFAULT 'unproven' NOT NULL;--> statement-breakpoint
ALTER TABLE "legal_act_resources" ADD CONSTRAINT "lar_legal_act_fk" FOREIGN KEY ("legal_act_id") REFERENCES "public"."legal_acts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_act_resources" ADD CONSTRAINT "lar_legal_act_version_fk" FOREIGN KEY ("legal_act_version_id") REFERENCES "public"."legal_act_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legal_act_resources_legal_act_id_idx" ON "legal_act_resources" USING btree ("legal_act_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_act_resources_source_url_uidx" ON "legal_act_resources" USING btree ("legal_act_id","source_url");