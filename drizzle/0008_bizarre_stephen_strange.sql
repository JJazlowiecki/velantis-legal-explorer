CREATE TABLE "explorer_saved_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visitor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "explorer_saved_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visitor_id" uuid NOT NULL,
	"folder_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"query" text,
	"content_key" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "explorer_saved_items" ADD CONSTRAINT "explorer_saved_items_folder_id_explorer_saved_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."explorer_saved_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "explorer_saved_folders_visitor_id_idx" ON "explorer_saved_folders" USING btree ("visitor_id");--> statement-breakpoint
CREATE INDEX "explorer_saved_items_visitor_id_created_at_idx" ON "explorer_saved_items" USING btree ("visitor_id","created_at");--> statement-breakpoint
CREATE INDEX "explorer_saved_items_visitor_id_folder_id_idx" ON "explorer_saved_items" USING btree ("visitor_id","folder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "explorer_saved_items_visitor_kind_content_key_uidx" ON "explorer_saved_items" USING btree ("visitor_id","kind","content_key");