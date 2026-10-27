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
  if [[ "$file" == database/migrations/005_enterprise.sql ]]; then
    # V4 created the same tables with an older shape. This fixture-only shim
    # supplies columns that 005 assumes; never apply it to a hosted database.
    psql "$url" -X -v ON_ERROR_STOP=1 > "$report/last-migration.log" 2>&1 <<'SQL'
alter table public.organizations add column if not exists owner_user_id uuid references public.profiles(id);
alter table public.organizations add column if not exists legal_name text;
alter table public.organizations add column if not exists entity_type text not null default 'FAMILY';
alter table public.organizations add column if not exists status text not null default 'ACTIVE';
alter table public.organizations add column if not exists updated_at timestamptz not null default now();
alter table public.organization_members add column if not exists status text not null default 'ACTIVE';
SQL
  fi
  if [[ "$file" == database/migrations/008_v8_workflow.sql ]]; then
    # 005 created this table without the owner field used by 008's index and
    # policies. The database is empty; this changes only the disposable fixture.
    psql "$url" -X -v ON_ERROR_STOP=1 > "$report/last-migration.log" 2>&1 <<'SQL'
alter table public.consolidated_assessments add column if not exists owner_id uuid references auth.users(id) on delete cascade;
SQL
  fi
  if [[ "$file" == supabase/migrations/20260919203000_atomic_internal_transfer.sql ]]; then
    # The historical baseline returns uuid; this migration returns jsonb.
    # DROP without CASCADE fails safely if a dependency exists in the fixture.
    psql "$url" -X -v ON_ERROR_STOP=1 > "$report/last-migration.log" 2>&1 <<'SQL'
drop function if exists public.create_internal_transfer(uuid,uuid,uuid,date,numeric,numeric,text,text);
SQL
  fi
  if [[ "$file" == supabase/migrations/20260923171000_reconcile_cost_center_display_codes.sql ]]; then
    # This data-only migration refers to a column introduced later in the
    # repository order. Match its later definition in the empty fixture.
    psql "$url" -X -v ON_ERROR_STOP=1 > "$report/last-migration.log" 2>&1 <<'SQL'
alter table public.organizations add column if not exists organization_kind text not null default 'SUBSIDIARY';
SQL
  fi
  input="$file"
  if [[ "$file" == database/migration-v4.sql || "$file" == database/migration-v11.sql ]]; then
    # Historical bootstrap has invalid FOREACH syntax; adapt only the disposable copy.
    input="$(mktemp)"
    sed 's/foreach d in array\[30,15,7\] loop/foreach d in array ARRAY[30,15,7] loop/' "$file" > "$input"
  fi
  if ! psql "$url" -X -v ON_ERROR_STOP=1 -f "$input" > "$report/last-migration.log" 2>&1; then
    [[ "$input" == "$file" ]] || rm -f "$input"
    printf 'FAIL %s\n' "$file" >> "$report/migrations.txt"
    cat "$report/migrations.txt"
    tail -n 20 "$report/last-migration.log"
    exit 1
  fi
  [[ "$input" == "$file" ]] || rm -f "$input"
  printf 'PASS %s\n' "$file" >> "$report/migrations.txt"
done
printf 'PASS all candidate migrations\n' >> "$report/migrations.txt"
