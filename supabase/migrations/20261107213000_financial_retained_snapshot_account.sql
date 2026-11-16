-- Versioned, fail-closed fix for configured but unreferenced retained-earnings leaves.
-- Only the account list of the LIVE statement snapshot changes. No historical
-- events, opening balances, posting rules, approvals or customer data are edited.
-- The source precondition is the verified Production 246-migration baseline.
do $retained_snapshot_migration$
declare
  definition text;
  needle text := $needle$where length(a->>'code')=4 or exists($needle$;
  replacement text := $replacement$where length(a->>'code')=4 or a->>'code'=(select retained_earnings_account from public.financial_fiscal_calendars where organization_id=p_org) or exists($replacement$;
  observed_source text;
begin
  if to_regprocedure('private.financial_statement_live_snapshot_v1(uuid,date,date)') is null
  then raise exception 'FISCAL_RETAINED_SNAPSHOT_FUNCTION_MISSING'; end if;
  select p.prosrc into observed_source from pg_proc p
   where p.oid='private.financial_statement_live_snapshot_v1(uuid,date,date)'::regprocedure;
  if md5(observed_source)<>'5c4b106f5b19efe0adb9570757173bb1'
  then raise exception 'FISCAL_RETAINED_SNAPSHOT_SOURCE_DRIFT'; end if;
  definition:=pg_get_functiondef('private.financial_statement_live_snapshot_v1(uuid,date,date)'::regprocedure);
  if strpos(definition,needle)=0
     or length(definition)-length(replace(definition,needle,''))<>length(needle)
  then raise exception 'FISCAL_RETAINED_SNAPSHOT_SELECTION_DRIFT'; end if;
  execute replace(definition,needle,replacement);
  select p.prosrc into observed_source from pg_proc p
   where p.oid='private.financial_statement_live_snapshot_v1(uuid,date,date)'::regprocedure;
  if md5(observed_source)<>'ac6d5bbbde12cea03102013554b331cb'
  then raise exception 'FISCAL_RETAINED_SNAPSHOT_PATCH_FAILED'; end if;
end $retained_snapshot_migration$;
