import { z } from "zod";

export const serverEnvSchema = z.object({
  DATABASE_URL: z.url({ error: "DATABASE_URL must be a valid URL" }),
  POSTGRES_DB: z.string().min(1, "POSTGRES_DB is required"),
  POSTGRES_USER: z.string().min(1, "POSTGRES_USER is required"),
  POSTGRES_PASSWORD: z.string().min(1, "POSTGRES_PASSWORD is required"),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-small"),
  OPENAI_ISSUE_DETECTION_MODEL: z.string().min(1).default("gpt-4o-mini"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(input: Record<string, string | undefined>): ServerEnv {
  return serverEnvSchema.parse(input);
}
