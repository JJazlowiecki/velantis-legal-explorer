CREATE TABLE "current_law_corpus_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"legal_act_id" uuid NOT NULL,
	"legal_act_version_id" uuid,
	"decision" text NOT NULL,
	"reason_code" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"runtime_ready" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "current_law_corpus_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"effective_as_of" date NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ruleset_version" text NOT NULL,
	"selection_hash" text NOT NULL,
	"status" text NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "explorer_history_entries" ADD COLUMN "corpus_run_id" uuid;--> statement-breakpoint
ALTER TABLE "explorer_history_entries" ADD COLUMN "ruleset_version" text;--> statement-breakpoint
ALTER TABLE "explorer_history_entries" ADD COLUMN "effective_as_of" date;--> statement-breakpoint
ALTER TABLE "current_law_corpus_entries" ADD CONSTRAINT "current_law_corpus_entries_run_id_current_law_corpus_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."current_law_corpus_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "current_law_corpus_entries" ADD CONSTRAINT "current_law_corpus_entries_legal_act_id_legal_acts_id_fk" FOREIGN KEY ("legal_act_id") REFERENCES "public"."legal_acts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "current_law_corpus_entries" ADD CONSTRAINT "current_law_corpus_entries_legal_act_version_id_legal_act_versions_id_fk" FOREIGN KEY ("legal_act_version_id") REFERENCES "public"."legal_act_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "current_law_corpus_entries_run_id_idx" ON "current_law_corpus_entries" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "current_law_corpus_entries_decision_idx" ON "current_law_corpus_entries" USING btree ("decision");--> statement-breakpoint
CREATE UNIQUE INDEX "current_law_corpus_entries_run_act_uidx" ON "current_law_corpus_entries" USING btree ("run_id","legal_act_id");--> statement-breakpoint
CREATE INDEX "current_law_corpus_runs_ruleset_version_idx" ON "current_law_corpus_runs" USING btree ("ruleset_version");--> statement-breakpoint
CREATE INDEX "current_law_corpus_runs_effective_as_of_idx" ON "current_law_corpus_runs" USING btree ("effective_as_of");--> statement-breakpoint
CREATE INDEX "current_law_corpus_runs_ruleset_status_generated_idx" ON "current_law_corpus_runs" USING btree ("ruleset_version","status","generated_at");--> statement-breakpoint
ALTER TABLE "explorer_history_entries" ADD CONSTRAINT "explorer_history_entries_corpus_run_id_current_law_corpus_runs_id_fk" FOREIGN KEY ("corpus_run_id") REFERENCES "public"."current_law_corpus_runs"("id") ON DELETE restrict ON UPDATE no action;