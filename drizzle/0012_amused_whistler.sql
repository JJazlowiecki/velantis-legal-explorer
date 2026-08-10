CREATE TABLE "verified_legal_answer_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_hash" text NOT NULL,
	"corpus_run_id" uuid NOT NULL,
	"ruleset_version" text NOT NULL,
	"effective_as_of" date NOT NULL,
	"corpus_selection_hash" text NOT NULL,
	"pipeline_version" text NOT NULL,
	"answer_snapshot" jsonb NOT NULL,
	"source_version_ids" jsonb NOT NULL,
	"source_pack_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_hit_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verified_legal_answer_cache" ADD CONSTRAINT "verified_legal_answer_cache_corpus_run_id_current_law_corpus_runs_id_fk" FOREIGN KEY ("corpus_run_id") REFERENCES "public"."current_law_corpus_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "verified_legal_answer_cache_identity_uidx" ON "verified_legal_answer_cache" USING btree ("question_hash","corpus_run_id","pipeline_version");--> statement-breakpoint
CREATE INDEX "verified_legal_answer_cache_corpus_run_id_idx" ON "verified_legal_answer_cache" USING btree ("corpus_run_id");