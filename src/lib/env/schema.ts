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
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(input: Record<string, string | undefined>): ServerEnv {
  return serverEnvSchema.parse(input);
}
