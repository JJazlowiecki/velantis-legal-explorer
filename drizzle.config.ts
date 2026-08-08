import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { z } from "zod";

loadEnv({ path: ".env" });

const schema = z.object({
  DATABASE_URL: z.url({ error: "DATABASE_URL must be a valid URL" }),
});

const env = schema.parse(process.env);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
});
