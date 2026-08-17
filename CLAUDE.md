@AGENTS.md

# Velantis Legal Explorer

## Architecture
- Next.js App Router + TypeScript, single repository, no separate backend
- PostgreSQL 17 + pgvector, Drizzle ORM
- Tailwind + shadcn/ui
- Native `fetch` to OpenAI (no SDK wrapper layer)
- Legal source data: official Polish government sources only (ELI / api.sejm.gov.pl)

## Legal corpus
- Current-law / present-only product — not a historical legal database
- Legal content revisions are immutable
- Supported sources: official ELI HTML, official born-digital consolidated PDF
- No OCR unless explicitly approved
- Currentness evaluation is fail-closed: uncertain, unresolved, or post-TJ-amended acts
  stay EXCLUDED — a correct exclusion is a valid outcome, never a bug to route around
- Never use unofficial or commercial legal databases
- Never build a general amendment-consolidation/legislative-diff engine unless explicitly
  requested

## Answer engine
- Pipeline version: `legal-answer-v5`
- Hybrid lexical/vector retrieval
- Exact hierarchical citation matching
- Max packed sources: 16
- Verifier + skeptic + deterministic verified final answer
- Verified-answer cache is exact-match, isolated by `(corpusRunId, pipelineVersion)`

## FROZEN unless explicitly requested
RRF, candidate ranking, packing, `maxSources`, answer targets, issue detection, verifier,
skeptic, recovery, answer pipeline prompts/version. Do not touch these while doing corpus,
ingestion, or currentness work.

## Engineering rules
- Simple, deterministic implementations only
- No microservices, no queues, no Redis, no Kubernetes, no speculative architecture
- No bespoke parser for a single act unless a genuinely new generic source format requires it
- Fix repeated/systemic failure classes, not individual stochastic misses
- Product usefulness and corpus coverage beat laboratory RAG tuning

## Cost / workflow rules
1. **DISCOVERY first** whenever there is real uncertainty: read-only, no DB writes, no
   embeddings, no broad test suite — end with a concise decision report
2. **IMPLEMENTATION** only after scope is proven by discovery
3. **VALIDATION** after implementation (see below)
4. Do not repeatedly re-investigate already-established facts
5. Avoid ingesting historical legal versions when only current-law coverage is needed,
   unless explicitly required
6. Reports should be concise and decision-oriented, not narrative
7. Never commit, push, merge, or create a PR unless explicitly instructed

## Validation defaults
- Targeted tests during implementation
- Before declaring done: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
- Required on every legal-answer change: source leaks = 0, unsupported verified claims = 0,
  false-currentness claims = 0

## Git
- Work on feature branches
- Preserve existing unrelated changes — never discard work you didn't create this session
- Never force-delete branches unless verified safe
