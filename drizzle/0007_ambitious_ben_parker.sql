CREATE TABLE "explorer_history_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visitor_id" uuid NOT NULL,
	"query" text NOT NULL,
	"status" text NOT NULL,
	"result_snapshot" jsonb NOT NULL,
	"corpus_version_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "explorer_history_entries_visitor_id_created_at_idx" ON "explorer_history_entries" USING btree ("visitor_id","created_at");