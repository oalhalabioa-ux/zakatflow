-- Adopt three already-existing Production schema definitions into canonical history.
-- No row update, deduplication, deletion, permission change or backfill is performed.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$
declare definition text;
 expected_constraint constant text := 'CHECK (center_type = ANY (ARRAY[''ADMIN''::text, ''OPERATING''::text, ''PROJECT_OPERATING''::text, ''INVESTMENT''::text, ''TREASURY''::text, ''FINANCING''::text]))';
 old_constraint constant text := 'CHECK (center_type = ANY (ARRAY[''ADMIN''::text, ''OPERATING''::text, ''INVESTMENT''::text, ''TREASURY''::text, ''FINANCING''::text]))';
 expected_index constant text := 'CREATE UNIQUE INDEX idx_budget_lines_active_identity ON public.budget_lines USING btree (plan_id, category, line_type, sort_order, name) WHERE (active = true)';
begin
 if to_regclass('public.budget_lines') is null or to_regclass('public.organization_cost_centers') is null then raise exception 'BUDGET_SOURCE_TABLES_REQUIRED';end if;
 if exists(select 1 from pg_catalog.pg_attribute where attrelid='public.budget_lines'::regclass and attname='active' and not attisdropped) then
  if not exists(select 1 from pg_catalog.pg_attribute a join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   where a.attrelid='public.budget_lines'::regclass and a.attname='active' and a.atttypid='boolean'::regtype and a.attnotnull and pg_catalog.pg_get_expr(d.adbin,d.adrelid)='true') then raise exception 'UNEXPECTED_BUDGET_ACTIVE_COLUMN';end if;
 else
  alter table public.budget_lines add column active boolean not null default true;
 end if;
 if to_regclass('public.idx_budget_lines_active_identity') is null then
  create unique index idx_budget_lines_active_identity on public.budget_lines(plan_id,category,line_type,sort_order,name) where active=true;
 end if;
 select pg_catalog.pg_get_indexdef('public.idx_budget_lines_active_identity'::regclass) into definition;
 if definition<>expected_index or not exists(select 1 from pg_catalog.pg_index where indexrelid='public.idx_budget_lines_active_identity'::regclass and indisvalid and indisready and indisunique) then raise exception 'UNEXPECTED_BUDGET_ACTIVE_INDEX';end if;
 select pg_catalog.pg_get_constraintdef(oid,true) into definition from pg_catalog.pg_constraint where conrelid='public.organization_cost_centers'::regclass and conname='organization_cost_centers_center_type_check';
 if definition=old_constraint then
  alter table public.organization_cost_centers drop constraint organization_cost_centers_center_type_check;
  alter table public.organization_cost_centers add constraint organization_cost_centers_center_type_check check(center_type in ('ADMIN','OPERATING','PROJECT_OPERATING','INVESTMENT','TREASURY','FINANCING'));
 elsif definition is distinct from expected_constraint then
  raise exception 'UNEXPECTED_COST_CENTER_TYPE_CONSTRAINT';
 end if;
end$$;
commit;
