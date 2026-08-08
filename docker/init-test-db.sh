#!/bin/sh
set -e

# Creates a second, disposable database for DB-backed integration tests, kept
# separate from POSTGRES_DB (the normal dev database) so `pnpm test` can never
# touch manually-ingested dev data. Only runs on first container init against
# a fresh volume, per the postgres image's docker-entrypoint-initdb.d behavior.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    CREATE DATABASE "${POSTGRES_DB}_test";
EOSQL
