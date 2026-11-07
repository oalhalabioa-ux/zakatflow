-- Read-only structural acceptance on a FULL, disposable clone of the
-- canonical Production migration history. Never run against hosted Production.
begin transaction read only;
do $$
declare
 function_source text;
 schema_columns_count integer;
 schema_columns_hash text;
 actual_source_hash text;
 expected record;
begin
 if to_regclass('public.financial_events') is null
    or to_regclass('public.financial_event_lines') is null
    or to_regclass('public.financial_event_obligations') is null
    or to_regclass('public.liquidity_flows') is null
    or to_regclass('public.transactions') is null
    or to_regclass('public.financial_opening_workspaces') is null
    or to_regclass('public.financial_reporting_policies') is null
    or to_regclass('public.financial_year_closures') is null
 then raise exception 'PARITY_REQUIRED_PRODUCTION_SOURCE_TABLE_ABSENT';end if;
 if to_regprocedure('public.financial_statement_live_snapshot(uuid,date,date)') is null
    or to_regprocedure('private.financial_statement_live_snapshot_v1(uuid,date,date)') is null
    or to_regprocedure('private.financial_reporting_events(uuid,date,date)') is null
    or to_regprocedure('private.financial_reporting_legacy_events(uuid,date,date)') is null
 then raise exception 'PARITY_REQUIRED_PRODUCTION_STATEMENT_PATH_ABSENT';end if;
 -- Baseline observed with READ-ONLY SQL on hosted Production,
 -- 2026-11-07: 246 applied migrations. Branch must reproduce the actual
 -- financial-source SQL definitions, not merely possess matching filenames.
 -- Deliberate Production changes require an explicit reviewed re-baseline.
 for expected in
  select * from (values
   ('private.financial_reporting_events(uuid,date,date)','4fd2ddad294ab23e3843353d37a4dbd8'),
   ('private.financial_reporting_legacy_events(uuid,date,date)','7cc105b3522efbedd9c0df2f66151d40'),
   ('private.financial_statement_live_snapshot_v1(uuid,date,date)','5c4b106f5b19efe0adb9570757173bb1'),
   ('public.financial_statement_live_snapshot(uuid,date,date)','1179052b55d75f80ffe04e3e13e8dfbf')
  ) as baseline(identity,required_md5)
 loop
  select md5(p.prosrc) into actual_source_hash
    from pg_proc p where p.oid=to_regprocedure(expected.identity);
  if actual_source_hash is distinct from expected.required_md5
  then raise exception 'PARITY_PRODUCTION_FINANCIAL_SOURCE_DRIFT: %',expected.identity;end if;
 end loop;
 -- This detects changed/missing source table columns even when migration
 -- names are identical. It deliberately excludes two new private PR tables.
 with cols as (
  select table_name||'.'||column_name||':'||data_type||':'||udt_name||':'||is_nullable k
  from information_schema.columns where table_schema='public'
   and table_name in(
    'financial_events','financial_event_lines','financial_event_obligations',
    'liquidity_flows','liquidity_transfers','liquidity_accounts',
    'transactions','transaction_allocations','financial_opening_workspaces',
    'financial_reporting_policies'
   )
 )
 select count(*),md5(string_agg(k,'|' order by k))
  into schema_columns_count,schema_columns_hash from cols;
 if schema_columns_count<>181 or
    schema_columns_hash is distinct from '357ffbca80fc03533b131f3705e31758'
 then raise exception 'PARITY_PRODUCTION_SOURCE_SCHEMA_DRIFT';end if;
 select pg_get_functiondef(to_regprocedure('private.financial_reporting_events(uuid,date,date)'))
  into function_source;
 if position('financial_reporting_legacy_events' in function_source)=0
    or position('INPUT_VAT' in function_source)=0
    or position('source_role' in function_source)=0
    or position('note-refund' in function_source)=0
 then raise exception 'PARITY_CANONICAL_VAT_LEGACY_OR_REFUND_SOURCE_NOT_COVERED';end if;
 select pg_get_functiondef(to_regprocedure('public.financial_statement_live_snapshot(uuid,date,date)'))
  into function_source;
 if position('financial_statement_live_snapshot_v1' in function_source)=0
    or position('financial_year_closures' in function_source)=0
 then raise exception 'PARITY_CLOSED_YEAR_STATEMENT_PATH_NOT_COVERED';end if;
end $$;
rollback;
