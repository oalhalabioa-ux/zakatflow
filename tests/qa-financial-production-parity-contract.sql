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
 -- Critical least-privilege baseline for original historical sources.
 -- A user permitted to view legal-company financial reports MUST NOT gain
 -- all other users' transaction lot allocations merely through an RLS tweak.
 -- An authoritative finance-scoped RPC is required to attest these amounts.
 if exists(
  select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in(
   'transactions','transaction_allocations','asset_accounts','liquidity_flows')
   and not c.relrowsecurity
 ) or (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in(
     'transactions','transaction_allocations','asset_accounts','liquidity_flows'))<>4
 then raise exception 'PARITY_FINANCIAL_SOURCE_RLS_MISSING';end if;
 if (select count(*) from pg_policy pol
  where pol.polrelid='public.transaction_allocations'::regclass
    and pol.polcmd in ('r','*')
    and pg_get_expr(pol.polqual,pol.polrelid) like '%user_id = auth.uid()%')<>1
 or exists(select 1 from pg_policy pol
  where pol.polrelid='public.transaction_allocations'::regclass
    and pol.polcmd in ('r','*')
    and pg_get_expr(pol.polqual,pol.polrelid) not like '%user_id = auth.uid()%')
 then raise exception 'PARITY_ASSET_COST_ALLOCATION_LEAST_PRIVILEGE_REGRESSED';end if;
 if not exists(select 1 from pg_policy pol
  where pol.polrelid='public.transactions'::regclass
   and pol.polcmd in ('r','*')
   and pg_get_expr(pol.polqual,pol.polrelid) like '%assets.view%')
 or not exists(select 1 from pg_policy pol
  where pol.polrelid='public.liquidity_flows'::regclass
   and pol.polcmd in ('r','*')
   and pg_get_expr(pol.polqual,pol.polrelid) like '%liquidity.view%')
 then raise exception 'PARITY_LEGACY_SOURCE_ORG_RLS_REGRESSED';end if;
 -- Baseline observed with READ-ONLY SQL on hosted Production,
 -- 2026-11-07: 246 applied migrations. Branch must reproduce the actual
 -- financial-source SQL definitions, not merely possess matching filenames.
 -- Deliberate Production changes require an explicit reviewed re-baseline.
 -- Snapshot function below expects the separately versioned retained-leaf
 -- migration applied to disposable QA, NOT a deployed Production function.
 for expected in
  select * from (values
   ('private.financial_reporting_events(uuid,date,date)','4fd2ddad294ab23e3843353d37a4dbd8'),
   ('private.financial_reporting_legacy_events(uuid,date,date)','7cc105b3522efbedd9c0df2f66151d40'),
   ('private.financial_statement_live_snapshot_v1(uuid,date,date)','ac6d5bbbde12cea03102013554b331cb'),
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
