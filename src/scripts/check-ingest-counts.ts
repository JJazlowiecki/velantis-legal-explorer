import { config as loadEnv } from "dotenv";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../db/schema";
import { parseServerEnv } from "../lib/env/schema";

async function main() {
  loadEnv({ path: ".env" });

  const env = parseServerEnv(process.env);
  const client = postgres(env.DATABASE_URL, { max: 1 });
  const db = drizzle({ client, schema });

  const acts = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.legalActs)
    .where(
      and(eq(schema.legalActs.source, "sejm_eli"), eq(schema.legalActs.sourceId, "DU/1964/93")),
    );

  const act = (
    await db
      .select({ id: schema.legalActs.id })
      .from(schema.legalActs)
      .where(
        and(eq(schema.legalActs.source, "sejm_eli"), eq(schema.legalActs.sourceId, "DU/1964/93")),
      )
      .limit(1)
  )[0];

  const versions = act
    ? await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.legalActVersions)
        .where(eq(schema.legalActVersions.legalActId, act.id))
    : [{ count: 0 }];

  const resolvedResources = act
    ? await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.legalActResources)
        .where(
          and(
            eq(schema.legalActResources.legalActId, act.id),
            isNotNull(schema.legalActResources.legalActVersionId),
          ),
        )
    : [{ count: 0 }];

  const unresolvedResources = act
    ? await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.legalActResources)
        .where(
          and(eq(schema.legalActResources.legalActId, act.id), isNull(schema.legalActResources.legalActVersionId)),
        )
    : [{ count: 0 }];

  console.log(`legal_acts_du_1964_93=${acts[0].count}`);
  console.log(`real_legal_versions_for_du_1964_93=${versions[0].count}`);
  console.log(`resolved_resources_for_du_1964_93=${resolvedResources[0].count}`);
  console.log(`unresolved_resources_for_du_1964_93=${unresolvedResources[0].count}`);

  await client.end({ timeout: 1 });
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error("count check failed");
  }

  process.exitCode = 1;
});
