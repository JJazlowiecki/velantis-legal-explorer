import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { parseServerEnv } from "../lib/env/schema";
import * as schema from "./schema";

loadEnv({ path: ".env" });

let cachedDb: ReturnType<typeof drizzle<typeof schema>> | undefined;
let cachedClient: ReturnType<typeof postgres> | undefined;

export function getScriptDb() {
  if (cachedDb) {
    return cachedDb;
  }

  const env = parseServerEnv(process.env);
  const client = postgres(env.DATABASE_URL, {
    max: 1,
  });

  cachedClient = client;
  cachedDb = drizzle({ client, schema });
  return cachedDb;
}

export async function closeScriptDb() {
  if (!cachedClient) {
    return;
  }

  await cachedClient.end({ timeout: 1 });
  cachedClient = undefined;
  cachedDb = undefined;
}
