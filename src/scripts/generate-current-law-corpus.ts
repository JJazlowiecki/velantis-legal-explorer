import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../db/schema";
import { CURRENT_LAW_BOOTSTRAP_SCOPE } from "../lib/legal/current-law/bootstrap-scope";
import { CurrentLawCorpusError, generateCurrentLawCorpus } from "../lib/legal/current-law/service";
import { parseServerEnv } from "../lib/env/schema";

class CliArgsError extends Error {}

function printUsage() {
	console.error("Usage: pnpm corpus:generate --effective-as-of YYYY-MM-DD");
}

function parseArgs(argv: string[]): { effectiveAsOf: string } {
	let effectiveAsOf: string | undefined;
	for (let i = 0; i < argv.length; i += 1) {
		if (argv[i] === "--effective-as-of") {
			effectiveAsOf = argv[i + 1];
			i += 1;
		}
	}
	if (!effectiveAsOf || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveAsOf)) {
		throw new CliArgsError("--effective-as-of YYYY-MM-DD is required");
	}
	return { effectiveAsOf };
}

async function main() {
	loadEnv({ path: ".env" });
	const env = parseServerEnv(process.env);
	const client = postgres(env.DATABASE_URL, { max: 1 });
	const db = drizzle({ client, schema });

	try {
		const { effectiveAsOf } = parseArgs(process.argv.slice(2));

		const result = await generateCurrentLawCorpus({ db, effectiveAsOf, scope: CURRENT_LAW_BOOTSTRAP_SCOPE });

		console.log("Current-law corpus run generated");
		console.log(`run_id: ${result.runId}`);
		console.log(`ruleset_version: ${result.rulesetVersion}`);
		console.log(`effective_as_of: ${result.effectiveAsOf}`);
		console.log(`selection_hash: ${result.selectionHash}`);
		console.log(`status: ${result.status}`);
		console.log(`\nIncluded (${result.included.length}):`);
		for (const item of result.included) {
			console.log(`  legalActId=${item.legalActId} versionId=${item.legalActVersionId} runtimeReady=${item.runtimeReady}`);
		}
		console.log(`\nExcluded by reason:`);
		for (const [reason, count] of Object.entries(result.excludedByReason)) {
			console.log(`  ${reason}: ${count}`);
		}
		if (result.unresolvedScope.length > 0) {
			console.log(`\nUnresolved scope (not ingested):`);
			for (const sourceId of result.unresolvedScope) console.log(`  ${sourceId}`);
		}
	} finally {
		await client.end({ timeout: 1 });
	}
}

main().catch((error: unknown) => {
	if (error instanceof CliArgsError) {
		printUsage();
		console.error(`Argument error: ${error.message}`);
		process.exitCode = 1;
		return;
	}
	if (error instanceof CurrentLawCorpusError) {
		console.error(`Corpus generation refused: ${error.message}`);
		process.exitCode = 1;
		return;
	}
	if (error instanceof Error) {
		console.error(`Corpus generation failed: ${error.name}: ${error.message}`);
	} else {
		console.error("Corpus generation failed");
	}
	process.exitCode = 1;
});
