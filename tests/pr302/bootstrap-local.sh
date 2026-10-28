#!/usr/bin/env bash
set -euo pipefail
url='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
report="${PR302_REPORT_DIR:?set PR302_REPORT_DIR}"
mkdir -p "$report"
printf 'Local-only isolated schema definitions; no application rows copied.\n' > "$report/migrations.txt"
if ! psql "$url" -X -1 -v ON_ERROR_STOP=1 -f tests/pr302/schema-history.sql > "$report/last-migration.log" 2>&1; then
  printf 'FAIL schema-history.sql; inspect last MIGRATION marker.\n' >> "$report/migrations.txt"
  tail -n 25 "$report/last-migration.log"
  exit 1
fi
psql "$url" -X -v ON_ERROR_STOP=1 -f tests/pr302/schema-preflight.sql >> "$report/last-migration.log" 2>&1
printf 'PASS schema and required objects\n' >> "$report/migrations.txt"
