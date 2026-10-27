#!/usr/bin/env bash
set -euo pipefail

# Refuse any database except the fixed local runner service.
url='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
report="${PR302_REPORT_DIR:?set PR302_REPORT_DIR}"
mkdir -p "$report"
printf 'Local-only migration attempt.\n' > "$report/migrations.txt"
baseline=(database/schema.sql database/migration-production.sql database/migration-v4.sql database/migrations/005_enterprise.sql database/migrations/006_consolidation.sql database/migrations/007_v7_commercial.sql database/migrations/008_v8_workflow.sql database/migration-v11.sql)
for file in "${baseline[@]}" supabase/migrations/*.sql; do
  if [[ ! -f "$file" ]]; then printf 'MISSING %s\n' "$file" >> "$report/migrations.txt"; exit 1; fi
  printf 'RUN %s\n' "$file" >> "$report/migrations.txt"
  if ! psql "$url" -X -v ON_ERROR_STOP=1 -f "$file" > "$report/last-migration.log" 2>&1; then
    printf 'FAIL %s\n' "$file" >> "$report/migrations.txt"
    cat "$report/migrations.txt"
    tail -n 20 "$report/last-migration.log"
    exit 1
  fi
  printf 'PASS %s\n' "$file" >> "$report/migrations.txt"
done
printf 'PASS all candidate migrations\n' >> "$report/migrations.txt"
