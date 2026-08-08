CREATE TABLE "legal_act_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_act_version_id" uuid NOT NULL,
	"source_type_codes" text NOT NULL,
	"representation_type" text NOT NULL,
	"file_name" text NOT NULL,
	"source_url" text NOT NULL,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legal_act_resources" ADD CONSTRAINT "legal_act_resources_legal_act_version_id_legal_act_versions_id_fk" FOREIGN KEY ("legal_act_version_id") REFERENCES "public"."legal_act_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legal_act_resources_legal_act_version_id_idx" ON "legal_act_resources" USING btree ("legal_act_version_id");--> statement-breakpoint
CREATE INDEX "legal_act_resources_representation_type_idx" ON "legal_act_resources" USING btree ("representation_type");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_act_resources_source_url_uidx" ON "legal_act_resources" USING btree ("legal_act_version_id","source_url");