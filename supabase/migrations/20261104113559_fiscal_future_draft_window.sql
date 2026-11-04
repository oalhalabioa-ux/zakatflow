-- Preparing a future fiscal opening is not the same as approving one.
-- A legacy 366-day input guard blocked valid drafts on non-January calendars.
-- Keep a bounded planning horizon; the separate approval guard continues to
-- reject approval before the chosen fiscal year has begun.
do $$
declare signature text; definition text;
begin
 foreach signature in array array[
  'public.financial_opening_workspace(uuid,date)',
  'public.save_financial_opening(uuid,date,integer,text,jsonb,text)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position('p_fiscal_start>current_date+366' in definition)=0 then
   raise exception 'FISCAL_DRAFT_GUARD_NOT_FOUND: %',signature;
  end if;
  definition:=replace(definition,'p_fiscal_start>current_date+366',
   $replacement$p_fiscal_start>(current_date+interval '5 years')::date$replacement$);
  execute definition;
 end loop;
end $$;
