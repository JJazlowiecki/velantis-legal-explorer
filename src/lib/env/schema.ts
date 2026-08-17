import { z } from "zod";

export const serverEnvSchema = z.object({
  DATABASE_URL: z.url({ error: "DATABASE_URL must be a valid URL" }),
  POSTGRES_DB: z.string().min(1, "POSTGRES_DB is required"),
  POSTGRES_USER: z.string().min(1, "POSTGRES_USER is required"),
  POSTGRES_PASSWORD: z.string().min(1, "POSTGRES_PASSWORD is required"),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-small"),
  OPENAI_ISSUE_DETECTION_MODEL: z.string().min(1).default("gpt-4o-mini"),
  OPENAI_FINAL_ANSWER_MODEL: z.string().min(1).default("gpt-4o-mini"),
  OPENAI_GROUNDING_VERIFICATION_MODEL: z.string().min(1).default("gpt-4o-mini"),
  // Second, skeptical verification pass (see src/lib/legal/answer/skeptic.ts) — deliberately
  // a separate setting from OPENAI_GROUNDING_VERIFICATION_MODEL so the two stages can be
  // tuned independently later, even though they share the same low-cost default today.
  OPENAI_GROUNDING_SKEPTIC_MODEL: z.string().min(1).default("gpt-4o-mini"),
  // Bounded, source-first recovery generation pass (see src/lib/legal/answer/recovery.ts) —
  // runs at most once, only when the normal pipeline produced zero verified conclusions
  // despite usable retrieval evidence. Deliberately a separate setting so it can be tuned
  // independently even though it shares the same low-cost default today.
  OPENAI_GROUNDING_RECOVERY_MODEL: z.string().min(1).default("gpt-4o-mini"),
  // Calibrated against text-embedding-3-small on the DU/1960/168 corpus: unrelated/nonsense
  // Polish queries scored up to ~0.30 cosine similarity (OpenAI embeddings have a non-zero
  // baseline for unrelated short legal text), while genuinely relevant queries scored 0.42+
  // (ordinary language) to 0.58+ (legal terminology). 0.35 sits with margin above the observed
  // noise ceiling and below the observed relevance floor. See src/lib/legal/search/service.ts.
  LEGAL_SEARCH_MIN_VECTOR_SIMILARITY: z.coerce
    .number()
    .min(-1, "LEGAL_SEARCH_MIN_VECTOR_SIMILARITY must be >= -1")
    .max(1, "LEGAL_SEARCH_MIN_VECTOR_SIMILARITY must be <= 1")
    .default(0.35),
  // Server-only, comma-separated legalActVersion UUIDs for the local /explorer technical
  // test corpus (see src/lib/explorer/corpus-config.ts). Never a global/default corpus —
  // missing or empty configuration is a hard error at the point of use, not silently ignored.
  EXPLORER_TEST_LEGAL_ACT_VERSION_IDS: z.string().optional(),
  // Explorer runtime mode (see src/lib/explorer/corpus-config.ts). "test" (default) uses the
  // historical env-var test corpus above, unchanged. "current" uses a persisted, operator-
  // pinned current-law-corpus run (see EXPLORER_CURRENT_CORPUS_RUN_ID below) — it NEVER falls
  // back to "test" or to "whatever the latest run happens to be".
  EXPLORER_CORPUS_MODE: z.enum(["test", "current"]).default("test"),
  // The specific current_law_corpus_runs.id Explorer must use in "current" mode. Deliberately
  // NOT auto-resolved to "the latest usable run" — a newer completed run can legitimately exist
  // precisely because new legal metadata made an older run's decisions unsafe, so the runtime
  // must never silently substitute one. Missing this in "current" mode is a valid, safely
  // handled "not ready" state, not a startup crash — see CurrentCorpusNotReadyError.
  EXPLORER_CURRENT_CORPUS_RUN_ID: z.uuid().optional(),
  // Explicit, validated on/off switch for persisting /explorer search history (see
  // src/lib/explorer/history/). Search queries can contain sensitive legal/personal
  // information, so this is opt-in via config rather than silently always-on — but defaults
  // to enabled since this whole app is local-only right now and the milestone's manual test
  // depends on it working out of the box. Revisit this default before any real deployment.
  // Only the literal strings "true"/"false" are accepted (unlike z.coerce.boolean(), which
  // would treat the string "false" as truthy).
  EXPLORER_HISTORY_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value !== "false"),
  // Hard cap on the number of Saved items per visitor (see src/lib/explorer/saved/). Folders
  // do not count toward this. This is a global MVP default, not a per-plan limit — the
  // service boundary (src/lib/explorer/saved/quota.ts) accepts the resolved limit as a plain
  // number so a future plan/subscription layer can compute a different value per visitor
  // without changing Saved persistence at all.
  EXPLORER_SAVED_MAX_ITEMS: z.coerce
    .number()
    .int("EXPLORER_SAVED_MAX_ITEMS must be an integer")
    .positive("EXPLORER_SAVED_MAX_ITEMS must be a positive integer")
    .default(100),
  // History retention (see src/lib/explorer/history/service.ts, cleanupHistoryForVisitor).
  // Two independent limits: entries older than this many days may be deleted, and each
  // visitor may keep at most EXPLORER_HISTORY_MAX_ENTRIES rows (oldest deleted first once
  // exceeded). Both are plain numbers passed into the cleanup function by its caller — the
  // service itself has no opinion on where they came from, so a future plan/account layer
  // could supply different values per visitor without rewriting persistence. Saved items are
  // a completely separate table and are never touched by this cleanup.
  EXPLORER_HISTORY_RETENTION_DAYS: z.coerce
    .number()
    .int("EXPLORER_HISTORY_RETENTION_DAYS must be an integer")
    .positive("EXPLORER_HISTORY_RETENTION_DAYS must be a positive integer")
    .default(90),
  EXPLORER_HISTORY_MAX_ENTRIES: z.coerce
    .number()
    .int("EXPLORER_HISTORY_MAX_ENTRIES must be an integer")
    .positive("EXPLORER_HISTORY_MAX_ENTRIES must be a positive integer")
    .default(300),

  // === Auth (Better Auth) ===
  // Signing secret for sessions/tokens. Required in production; a fixed local-only fallback
  // is used in development ONLY (see src/lib/auth/auth.ts) so `pnpm dev` works out of the box.
  BETTER_AUTH_SECRET: z.string().min(1).optional(),
  // Canonical origin Better Auth issues links against (password-reset/verification emails,
  // redirect validation). Also doubles as the one entry in `trustedOrigins` unless overridden.
  APP_BASE_URL: z.url({ error: "APP_BASE_URL must be a valid URL" }).default("http://localhost:3000"),

  // === Transactional mail (password reset / email verification) ===
  // Minimal HTTP-API mail adapter (see src/lib/mail/send.ts) — Resend-compatible request
  // shape. Both must be present for mail to actually send; either missing means "not
  // configured" (safe no-op, never a fake success) rather than a startup crash.
  MAIL_API_KEY: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1).optional(),

  // === Stripe (test mode only in this milestone) ===
  // All four optional: local dev/tests must work with billing entirely absent (see
  // src/lib/billing/stripe.ts) — FREE plan works, paid buttons show a truthful
  // "billing not configured" state, and the webhook route fails closed.
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRICE_BASIC: z.string().min(1).optional(),
  STRIPE_PRICE_PLUS: z.string().min(1).optional(),

  // === Trust / legal shell (see src/app/(legal)/*, src/lib/legal-shell/config.ts) ===
  // Plain informational placeholders, never invented — absence renders a generic fallback in
  // the draft legal copy rather than a fabricated company identity.
  COMPANY_NAME: z.string().min(1).optional(),
  CONTACT_EMAIL: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(input: Record<string, string | undefined>): ServerEnv {
  return serverEnvSchema.parse(input);
}
