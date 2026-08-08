import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getServerEnv } from "@/lib/env/server";
import * as schema from "@/db/schema";

const globalForDb = globalThis as unknown as {
  client: postgres.Sql | undefined;
  db: ReturnType<typeof drizzle<typeof schema>> | undefined;
};

function getClient() {
  if (globalForDb.client) {
    return globalForDb.client;
  }

  const env = getServerEnv();
  const client = postgres(env.DATABASE_URL, {
    max: 5,
  });

  if (process.env.NODE_ENV !== "production") {
    globalForDb.client = client;
  }

  return client;
}

function getDb() {
  if (globalForDb.db) {
    return globalForDb.db;
  }

  const db = drizzle({ client: getClient(), schema });

  if (process.env.NODE_ENV !== "production") {
    globalForDb.db = db;
  }

  return db;
}

export { getDb };

export async function checkDatabaseConnection() {
  await getClient()`select 1`;
}
