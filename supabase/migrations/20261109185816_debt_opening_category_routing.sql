-- Route newly tagged debt sources by their immutable source category. Historical
-- untagged contracts retain their previous classification; no saved rows change.
create function private.financial_debt_source_account(p_org uuid,p_event uuid,p_side text)
returns text language plpgsql stable set search_path='' as $$
declare role text;category text;
begin
 select metadata->>'source_role' into role from public.financial_event_lines
 where organization_id=p_org and event_id=p_event and line_number=1;
 if role like 'DEBT_OPENING_%' then category:=substr(role,length('DEBT_OPENING_')+1);
 elsif role like 'DEBT_FUNDED_%' then category:=substr(role,length('DEBT_FUNDED_')+1);
 else return case when p_side='PAYABLE' then '2200' else '1200' end;end if;
 if p_side='RECEIVABLE' then
  if category='O_AR_LOAN' then return '1200';end if;
  if category in('O_AR_CUSTOMER','O_AR_EMPLOYEE','O_AR_RELATED','O_AR_ACCRUED','O_AR_OTHER') then return '1100';end if;
 elsif p_side='PAYABLE' then
  if category='O_AP_LOAN' then return '2200';end if;
  if category in('O_AP_SUPPLIER','O_AP_ACCRUAL','O_AP_EMPLOYEE','O_AP_RELATED','O_AP_OTHER') then return '2100';end if;
 end if;
 raise exception 'FISCAL_DEBT_CATEGORY_INVALID';
end $$;
revoke all on function private.financial_debt_source_account(uuid,uuid,text) from public,anon,authenticated;

do $$
declare definition text;fn text;needle text;
begin
 fn:='private.financial_opening_sources(uuid,date)';
 definition:=pg_get_functiondef(fn::regprocedure);
 needle:=$n$case when c.id is not null then case when o.obligation_type='PAYABLE' then '2200' else '1200' end$n$;
 if strpos(definition,needle)=0 or strpos(definition,'case when c.id is not null then ''loans''')=0 then raise exception 'DEBT_OPENING_SOURCE_SIGNATURE_CHANGED';end if;
 definition:=replace(definition,needle,'case when c.id is not null then private.financial_debt_source_account(p_org,e.id,o.obligation_type)');
 definition:=replace(definition,'case when c.id is not null then ''loans''',
 'case when c.id is not null then case when private.financial_debt_source_account(p_org,e.id,o.obligation_type) in(''1200'',''2200'') then ''loans'' when o.obligation_type=''PAYABLE'' then ''suppliers'' else ''customers'' end');
 execute definition;
 foreach fn in array array['private.financial_period_opening_sources(uuid,date)','public.financial_opening_candidates(uuid,date)'] loop
  definition:=pg_get_functiondef(fn::regprocedure);
  needle:=$n$case when ob.obligation_type='PAYABLE' then '2200' else '1200' end$n$;
  if strpos(definition,needle)=0 then raise exception 'DEBT_OPENING_PERIOD_SIGNATURE_CHANGED: %',fn;end if;
  execute replace(definition,needle,'private.financial_debt_source_account(p_org,ob.event_id,ob.obligation_type)');
 end loop;
end $$;
