import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../db/schema";
import { resolveCurrentCorpus } from "../lib/explorer/corpus-config";
import { CURRENT_LAW_EVAL_QUESTIONS } from "../lib/legal/current-law/eval-set/questions";
import { answerLegalProblem } from "../lib/legal/answer/answer";
import { parseServerEnv } from "../lib/env/schema";

class CliArgsError extends Error {}

function printUsage() {
	console.error("Usage: pnpm corpus:eval --run-id <UUID>");
}

function parseArgs(argv: string[]): { runId: string } {
	let runId: string | undefined;
	for (let i = 0; i < argv.length; i += 1) {
		if (argv[i] === "--run-id") {
			runId = argv[i + 1];
			i += 1;
		}
	}
	if (!runId) throw new CliArgsError("--run-id is required");
	return { runId };
}

async function main() {
	loadEnv({ path: ".env" });
	const env = parseServerEnv(process.env);
	const client = postgres(env.DATABASE_URL, { max: 1 });
	const db = drizzle({ client, schema });

	try {
		const { runId } = parseArgs(process.argv.slice(2));
		const corpus = await resolveCurrentCorpus({ db, runId });
		if (!corpus) {
			console.error(`Run ${runId} is not usable (missing/not completed/zero runtimeReady entries)`);
			process.exitCode = 1;
			return;
		}

		console.log(`Evaluating ${CURRENT_LAW_EVAL_QUESTIONS.length} questions against run ${runId}`);
		console.log(`Corpus: ${corpus.legalActVersionIds.length} version(s), effectiveAsOf=${corpus.effectiveAsOf}\n`);

		const allowedVersionIds = new Set(corpus.legalActVersionIds);
		let answered = 0;
		let insufficient = 0;
		let structuralFailures = 0;

		for (const question of CURRENT_LAW_EVAL_QUESTIONS) {
			try {
				const result = await answerLegalProblem({
					problemDescription: question.query,
					legalActVersionIds: corpus.legalActVersionIds,
					db,
				});

				if (result.status === "answered") answered += 1;
				else insufficient += 1;

				const badSources = result.sources.filter((s) => !allowedVersionIds.has(s.legalActVersionId));
				const structurallyOk = badSources.length === 0 && (result.status === "answered" || result.status === "insufficient_evidence");
				if (!structurallyOk) structuralFailures += 1;

				console.log(
					`[${question.id}] status=${result.status} sources=${result.sources.length} badSources=${badSources.length} expectedInScope=${question.expectedInScope}`,
				);
				console.log(`  query: ${question.query}`);
			} catch (error) {
				structuralFailures += 1;
				console.log(`[${question.id}] ERROR: ${error instanceof Error ? error.message : "unknown error"}`);
			}
		}

		console.log(`\n=== Summary ===`);
		console.log(`answered: ${answered}`);
		console.log(`insufficient_evidence: ${insufficient}`);
		console.log(`structural failures (bad source / thrown error): ${structuralFailures}`);
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
	if (error instanceof Error) {
		console.error(`Eval run failed: ${error.name}: ${error.message}`);
	} else {
		console.error("Eval run failed");
	}
	process.exitCode = 1;
});
