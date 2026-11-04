-- Forward-only fiscal retained earnings mapping. The legacy 3300 control is
-- retained for historic calendars. New UI configurations select a posting leaf
-- beneath it; the next opening remains aggregated on canonical 3300.

create function private.financial_retained_account_valid(p_org uuid,p_code text)
returns boolean language sql stable security invoker set search_path='' as $$
 select p_code='3300' or exists (
  select 1 from public.financial_chart_custom_accounts c
  where c.organization_id=p_org and c.code=p_code
    and c.reporting_code='3300' and c.normal_side='CREDIT'
    and c.is_active and c.is_postable
 )
$$;
revoke all on function private.financial_retained_account_valid(uuid,text) from public,anon,authenticated;

-- A postable leaf may not appear in the reporting snapshot until a policy or
-- opening voucher refers to it. Explicitly include the configured leaf before
-- annual profit rollover without adding an opening balance or a duplicate row.
create function private.financial_retained_include_account(p_org uuid,p_snapshot jsonb,p_retained text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare account jsonb;
begin
 if p_snapshot->>'organizationId' is distinct from p_org::text then
  raise exception 'FISCAL_SOURCE_SCOPE_INVALID';
 end if;
 if p_retained='3300' then return p_snapshot;end if;
 if not private.financial_retained_account_valid(p_org,p_retained) then
  raise exception 'FISCAL_RETAINED_ACCOUNT_REQUIRED';
 end if;
 if exists(select 1 from jsonb_array_elements(p_snapshot->'accounts') a where a->>'id'=p_retained) then
  return p_snapshot;
 end if;
 select a into account from jsonb_array_elements(public.financial_chart_posting_accounts(p_org)) a
 where a->>'id'=p_retained and a->>'reportingCode'='3300';
 if account is null then raise exception 'FISCAL_RETAINED_ACCOUNT_REQUIRED';end if;
 return jsonb_set(p_snapshot,'{accounts}',p_snapshot->'accounts'||
  jsonb_build_array(account||jsonb_build_object('organizationId',p_org,'currency',p_snapshot->>'currency')));
end $$;
revoke all on function private.financial_retained_include_account(uuid,jsonb,text) from public,anon,authenticated;

-- Keep the existing fiscal RPC signature, RLS permission check, budget guard,
-- locking and period audit intact; patch just the validated lookup and trial.
do $$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.save_financial_fiscal_calendar(uuid,integer,integer,text,integer,text)'::regprocedure);
 needle:=$old$or not exists(select 1 from jsonb_array_elements(public.financial_reporting_chart()) a where a->>'code'=p_retained and a->>'kind'='EQUITY')$old$;
 if strpos(definition,needle)=0 then raise exception 'FISCAL_RETAINED_CALENDAR_SIGNATURE_CHANGED';end if;
 execute replace(definition,needle,'or not private.financial_retained_account_valid(p_org,p_retained)');

 definition:=pg_get_functiondef('public.close_financial_year(uuid,date,uuid,text)'::regprocedure);
 needle:='computed:=private.financial_fiscal_trial(source,retained);';
 if strpos(definition,needle)=0 then raise exception 'FISCAL_RETAINED_CLOSE_SIGNATURE_CHANGED';end if;
 execute replace(definition,needle,
  'source:=private.financial_retained_include_account(p_org,source,retained); '||needle);
end $$;

-- Protect the financial calendar's selected account even when no posting
-- policy happens to refer to it. Renaming stays allowed and audited.
create function private.financial_chart_guard_retained_reference()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  if exists(select 1 from public.financial_fiscal_calendars f
     where f.organization_id=old.organization_id and f.retained_earnings_account=old.code) then
   raise exception 'FISCAL_RETAINED_ACCOUNT_IN_USE';
  end if;
  return old;
 end if;
 if exists(select 1 from public.financial_fiscal_calendars f
     where f.organization_id=old.organization_id and f.retained_earnings_account=old.code)
   and (not new.is_active or not new.is_postable
     or new.normal_side<>'CREDIT' or new.reporting_code<>'3300') then
  raise exception 'FISCAL_RETAINED_ACCOUNT_IN_USE';
 end if;
 return new;
end $$;
create trigger financial_chart_guard_retained_reference
 before update or delete on public.financial_chart_custom_accounts
 for each row execute function private.financial_chart_guard_retained_reference();
revoke all on function private.financial_chart_guard_retained_reference() from public,anon,authenticated;
notify pgrst,'reload schema';
