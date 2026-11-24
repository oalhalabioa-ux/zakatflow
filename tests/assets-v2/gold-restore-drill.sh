#!/usr/bin/env bash
# Disposable CI database only. Rebuild a separate copy of each financial table from pg_dump.
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${PGHOST:-} == 127.0.0.1 && ${PGPORT:-} == 54322 ]]
db_container=$(docker ps --filter name=supabase_db_ --format '{{.Names}}')
[[ $db_container == supabase_db_* && $db_container != *$'\n'* ]]
psql -X -v ON_ERROR_STOP=1 -c 'create schema qa_restore'
tables=(public.transactions public.transaction_allocations public.lots public.audit_logs public.zakat_assessments public.zakat_assessment_lines private.grouped_sale_reversals)
for source in "${tables[@]}"; do
  name=${source#*.}
  psql -X -v ON_ERROR_STOP=1 -c "create table qa_restore.$name (like $source)"
  docker exec "$db_container" pg_dump -U postgres -d postgres --data-only --no-owner --no-privileges --table="$source" |
    sed "s/^COPY $source (/COPY qa_restore.$name (/" |
    docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null
  psql -X -v ON_ERROR_STOP=1 -c "do \$\$ begin if exists((table $source except all table qa_restore.$name) union all (table qa_restore.$name except all table $source)) then raise exception 'restore mismatch for $source'; end if; end \$\$;"
done
psql -X -v ON_ERROR_STOP=1 -c "do \$\$ begin if not exists(select 1 from qa_restore.transactions where metadata ? 'lot_sale_request') then raise exception 'no grouped sale restored'; end if; end \$\$;"
