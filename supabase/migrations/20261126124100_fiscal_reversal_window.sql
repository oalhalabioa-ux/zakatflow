-- Keep the reversal check on the same posted journals as the trial calculation.
do $migration$
declare
 body text := pg_get_functiondef('private.financial_fiscal_trial_detail_v1(jsonb,text)'::regprocedure);
 old_loop text := 'where e->>''reversesEventId'' is not null loop';
 new_loop text := 'where e->>''reversesEventId'' is not null and event_balances ? (e->>''id'') loop';
 cash_check text := 'if (l->>''cashDirection''=''NON_CASH'' and (cash_d or cash_c))';
begin
 if strpos(body,old_loop)=0 or strpos(body,cash_check)=0 then
  raise exception 'FISCAL_TRIAL_SIGNATURE_CHANGED';
 end if;
 body:=replace(body,old_loop,new_loop);
 body:=replace(body,cash_check,
  'if d=c and not (cash_d and l->>''cashDirection''<>''NON_CASH'') then raise exception ''FISCAL_ACCOUNT_INVALID''; end if; '||cash_check);
 execute body;
end $migration$;
