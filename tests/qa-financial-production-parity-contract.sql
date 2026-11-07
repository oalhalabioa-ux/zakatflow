-- Read-only structural acceptance on a FULL, disposable clone of the
-- canonical Production migration history. Never run against hosted Production.
begin transaction read only;
do $$
declare function_source text;
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
