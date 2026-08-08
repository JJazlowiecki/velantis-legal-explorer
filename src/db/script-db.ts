import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { parseServerEnv } from "../lib/env/schema";
import * as schema from "./schema";

loadEnv({ path: ".env" });

let cachedDb: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getScriptDb() {
  if (cachedDb) {
    return cachedDb;
  }

  const env = parseServerEnv(process.env);
  const client = postgres(env.DATABASE_URL, {
    max: 1,
  });

  cachedDb = drizzle({ client, schema });
  return cachedDb;
}
