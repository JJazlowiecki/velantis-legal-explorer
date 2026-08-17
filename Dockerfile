FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
RUN corepack enable

FROM base AS deps
WORKDIR /app
# CI=true makes pnpm resolve its build-script-approval prompt non-interactively (using the
# already-decided policy below) instead of failing with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY
# in a TTY-less Docker build. pnpm-workspace.yaml's `allowBuilds` is the actual policy record
# (currently declining esbuild/sharp/unrs-resolver build scripts) — it must be copied alongside
# package.json/pnpm-lock.yaml or pnpm has nothing to resolve the prompt against.
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `next build` statically analyzes/prerenders pages, which requires the server env schema
# (src/lib/env/schema.ts) to parse successfully even for pages that don't touch the database
# at all (e.g. /legal) — the schema is validated as one atomic unit. These are BUILD-TIME-ONLY
# placeholders, never used to actually connect to anything (no build step opens a DB
# connection) — real values are supplied at container RUN time via `docker run --env-file`
# or your orchestrator's env injection. See docs/PRODUCTION.md item J.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build_placeholder
ENV POSTGRES_DB=build_placeholder
ENV POSTGRES_USER=build
ENV POSTGRES_PASSWORD=build
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
