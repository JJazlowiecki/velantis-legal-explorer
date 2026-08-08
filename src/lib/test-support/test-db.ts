import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../../db/schema";

/**
 * DB-backed integration tests are destructive (they delete/reinsert rows).
 * They must run only against TEST_DATABASE_URL, never the developer's
 * DATABASE_URL, so `pnpm test` can never alter a manually-ingested dev corpus.
 */
export class UnsafeTestDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeTestDatabaseError";
  }
}

function assertSafeTestDatabaseUrl(testDatabaseUrl: string, developmentDatabaseUrl: string | undefined): void {
  if (developmentDatabaseUrl && testDatabaseUrl === developmentDatabaseUrl) {
    throw new UnsafeTestDatabaseError(
      "TEST_DATABASE_URL must not equal DATABASE_URL: refusing to run destructive integration tests against the development database",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(testDatabaseUrl);
  } catch {
    throw new UnsafeTestDatabaseError("TEST_DATABASE_URL must be a valid connection URL");
  }

  const databaseName = parsed.pathname.replace(/^\//, "");
  if (!databaseName.toLowerCase().includes("test")) {
    throw new UnsafeTestDatabaseError(
      `TEST_DATABASE_URL database name "${databaseName}" must contain "test" as a local safety check`,
    );
  }
}

/**
 * Returns TEST_DATABASE_URL, or undefined if it isn't configured (tests should
 * skip in that case, per project convention). Throws if it's configured but
 * unsafe (equal to DATABASE_URL, or a database name that doesn't look test-only).
 */
export function getTestDatabaseUrl(): string | undefined {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    return undefined;
  }

  assertSafeTestDatabaseUrl(testDatabaseUrl, process.env.DATABASE_URL);
  return testDatabaseUrl;
}

export interface TestDatabaseHandle {
  client: postgres.Sql;
  db: ReturnType<typeof drizzle<typeof schema>>;
}

/** Returns undefined when TEST_DATABASE_URL is unset; throws when it's unsafe. */
export function createTestDatabase(): TestDatabaseHandle | undefined {
  const testDatabaseUrl = getTestDatabaseUrl();
  if (!testDatabaseUrl) {
    return undefined;
  }

  const client = postgres(testDatabaseUrl, { max: 1 });
  const db = drizzle({ client, schema });
  return { client, db };
}
