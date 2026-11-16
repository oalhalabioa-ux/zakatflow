-- An organization can enter distinct capital/reserve/retained-earnings detail
-- accounts without moving or duplicating an existing source-backed opening row.
-- Existing opening drafts and approved rows are never rewritten by this migration.

create function private.financial_opening_extra_equity_allowed(
 p_org uuid,p_key text,p_entry jsonb,p_entries jsonb
) returns boolean language plpgsql stable security definer set search_path='' as $$
declare account_code text;control_code text;
begin
 if p_key !~ '^equity-child:[0-9]{6}([0-9]{2}){0,2}$'
  or jsonb_typeof(p_entry) is distinct from 'object'
  or p_entry ? 'accountCode' then return false;end if;
 account_code:=substr(p_key,14);
 select c.reporting_code into control_code
 from public.financial_chart_custom_accounts c
 where c.organization_id=p_org and c.code=account_code and c.is_active and c.is_postable
  and c.reporting_code in('3100','3200','3300');
 if control_code is null then return false;end if;
 -- The fixed historical parent row may already represent this exact child.
 -- It must not silently become a second opening for the same account.
 if exists(select 1 from jsonb_each(p_entries) e
  where e.key in('equity:3100','equity:3200','equity:3300')
   and e.value->>'accountCode'=account_code) then return false;end if;
 return true;
end $$;
revoke all on function private.financial_opening_extra_equity_allowed(uuid,text,jsonb,jsonb) from public,anon,authenticated;

do $$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.save_financial_opening(uuid,date,integer,text,jsonb,text)'::regprocedure);
 needle:='if not exists(select 1 from jsonb_array_elements(rows) r where r->>''id''=k)';
 replacement:='if not (exists(select 1 from jsonb_array_elements(rows) r where r->>''id''=k) or private.financial_opening_extra_equity_allowed(p_org,k,v,p_entries))';
 if strpos(definition,needle)=0 then raise exception 'EQUITY_OPENING_SAVE_SIGNATURE_CHANGED';end if;
 execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('public.approve_financial_opening(uuid,integer)'::regprocedure);
 needle:='if total<>0 then raise exception ''OPENING_UNBALANCED'';end if;';
 replacement:=$new$
 -- Supplemental equity rows are explicitly added by the user. They have no
 -- source vouchers and belong to one organization-owned posting leaf each.
 for r in select jsonb_build_object('id',e.key,'entry',e.value) from jsonb_each(w.entries) e
  where e.key like 'equity-child:%' order by e.key loop
  v:=r->'entry';
  if not private.financial_opening_extra_equity_allowed(w.organization_id,r->>'id',v,w.entries)
   then raise exception 'OPENING_ACCOUNT_INVALID';end if;
  if coalesce(v->>'amount','')='' then raise exception 'OPENING_INCOMPLETE';end if;
  amount:=((v->>'amount')::numeric)*case when v->>'side'='CREDIT' then -1 else 1 end;
  if amount>0 and length(trim(coalesce(v->>'reason','')))<3
   then raise exception 'OPENING_CORRECTION_REASON_REQUIRED';end if;
  total:=total+amount;
  volume:=volume+greatest(amount,0);
  opening:=opening||jsonb_build_array(jsonb_build_object(
   'itemId',r->>'id','accountCode',substr(r->>'id',14),
   'debit',greatest(amount,0)::numeric(24,4)::text,
   'credit',greatest(-amount,0)::numeric(24,4)::text));
 end loop;
 if total<>0 then raise exception 'OPENING_UNBALANCED';end if;$new$;
 if strpos(definition,needle)=0 then raise exception 'EQUITY_OPENING_APPROVAL_SIGNATURE_CHANGED';end if;
 execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('private.financial_chart_guard_opening_reference()'::regprocedure);
 needle:='or exists(select 1 from jsonb_array_elements(opening.approved_opening) line';
 replacement:='or opening.entries ? (''equity-child:''||old.code) or exists(select 1 from jsonb_array_elements(opening.approved_opening) line';
 if strpos(definition,needle)=0 then raise exception 'EQUITY_OPENING_CHART_GUARD_SIGNATURE_CHANGED';end if;
 execute replace(definition,needle,replacement);
end $$;

notify pgrst,'reload schema';
