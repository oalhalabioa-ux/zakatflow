-- Phase 2b: preserve the source-voucher identity while mapping an approved
-- opening register row to an organization-owned postable account. Historical
-- approvals, source dates, and existing ledger entries remain untouched.

create function private.financial_opening_account_allowed(p_org uuid,p_control text,p_selected text)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if p_selected is null or p_control is null then return false;end if;
 if p_selected ~ '^[0-9]{4}$' then
  -- Preserve the original four-digit correction workflow. No income or
  -- expense account may be used as a balance-sheet opening account.
  return exists(select 1 from jsonb_array_elements(public.financial_reporting_chart()) root
   where root->>'code'=p_selected and root->>'kind' in('ASSET','LIABILITY','EQUITY'));
 end if;
 if p_selected !~ '^[0-9]{6}([0-9]{2}){0,2}$' then return false;end if;
 return exists(select 1 from public.financial_chart_custom_accounts child
  join lateral (select root from jsonb_array_elements(public.financial_reporting_chart()) root
   where root->>'code'=child.reporting_code) canonical on true
  where child.organization_id=p_org and child.code=p_selected and child.reporting_code=p_control
   and child.is_active and child.is_postable and canonical.root->>'kind' in('ASSET','LIABILITY','EQUITY'));
end $$;
revoke all on function private.financial_opening_account_allowed(uuid,text,text) from public,anon,authenticated;

create function private.financial_chart_guard_opening_reference()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (old.normal_side is distinct from new.normal_side
     or (old.is_active and not new.is_active)
     or (old.is_postable and not new.is_postable))
  and exists(select 1 from public.financial_opening_workspaces opening
   where opening.organization_id=old.organization_id and opening.status in('DRAFT','APPROVED')
    and (exists(select 1 from jsonb_each(opening.entries) entry where entry.value->>'accountCode'=old.code)
      or exists(select 1 from jsonb_array_elements(opening.approved_opening) line where line->>'accountCode'=old.code)))
 then raise exception 'CHART_REFERENCED_BY_OPENING';end if;
 return new;
end $$;
create trigger financial_chart_guard_opening_reference before update on public.financial_chart_custom_accounts
 for each row execute function private.financial_chart_guard_opening_reference();
revoke all on function private.financial_chart_guard_opening_reference() from public,anon,authenticated;

-- Amend only specific expressions in the currently installed routines. These
-- already have fiscal-year gates, source assignment controls, RLS permissions,
-- self-approval checks, and closed-year handling added by earlier migrations.
do $$
declare signature text;definition text;needle text;replacement text;
begin
 foreach signature in array array[
  'public.financial_opening_workspace(uuid,date)',
  'public.save_financial_opening(uuid,date,integer,text,jsonb,text)',
  'public.approve_financial_opening(uuid,integer)',
  'private.financial_statement_live_snapshot_v1(uuid,date,date)',
  'public.financial_chart_workspace(uuid)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if signature='public.financial_opening_workspace(uuid,date)' then
   needle:='''chart'',public.financial_reporting_chart()';
   replacement:='''chart'',public.financial_chart_posting_accounts(p_org)';
  elsif signature='public.save_financial_opening(uuid,date,integer,text,jsonb,text)' then
   needle:=$old$or v->>'accountCode' is not null and not exists(select 1 from jsonb_array_elements(public.financial_reporting_chart()) a where a->>'code'=v->>'accountCode' and a->>'kind' in('ASSET','LIABILITY','EQUITY'))$old$;
   replacement:=$new$or (v->>'accountCode' is not null and not private.financial_opening_account_allowed(p_org,
    (select source_row->>'accountCode' from jsonb_array_elements(rows) source_row where source_row->>'id'=k),v->>'accountCode'))$new$;
   if strpos(definition,'select * into w from public.financial_opening_workspaces')=0 then raise exception 'CHART_OPENING_SAVE_SIGNATURE_CHANGED';end if;
   definition:=replace(definition,'select * into w from public.financial_opening_workspaces',
    E'perform pg_advisory_xact_lock(hashtextextended(''chart-accounts:''||p_org::text,0));\n select * into w from public.financial_opening_workspaces');
  elsif signature='public.approve_financial_opening(uuid,integer)' then
   needle:=$old$amount:=coalesce((select sum((a->>'debit')::numeric-(a->>'credit')::numeric) from jsonb_array_elements(r->'vouchers') a),0)$old$;
   replacement:=$new$if v->>'accountCode' is not null and not private.financial_opening_account_allowed(w.organization_id,r->>'accountCode',v->>'accountCode') then
   raise exception 'OPENING_ACCOUNT_INVALID';end if;
   amount:=coalesce((select sum((a->>'debit')::numeric-(a->>'credit')::numeric) from jsonb_array_elements(r->'vouchers') a),0)$new$;
   if strpos(definition,'select * into w from public.financial_opening_workspaces where id=p_id for update')=0 then raise exception 'CHART_OPENING_APPROVE_SIGNATURE_CHANGED';end if;
   definition:=replace(definition,'select * into w from public.financial_opening_workspaces where id=p_id for update',
    E'perform pg_advisory_xact_lock(hashtextextended(''chart-accounts:''||w.organization_id::text,0));\n select * into w from public.financial_opening_workspaces where id=p_id for update');
  elsif signature='private.financial_statement_live_snapshot_v1(uuid,date,date)' then
   needle:='where length(a->>''code'')=4 or exists(';
   replacement:=$new$where length(a->>'code')=4 or exists(
    select 1 from jsonb_array_elements(w.approved_opening) opening_line
     where opening_line->>'accountCode'=a->>'code') or exists($new$;
   if strpos(definition,needle)=0 then raise exception 'CHART_OPENING_SNAPSHOT_ACCOUNT_SIGNATURE_CHANGED';end if;
   definition:=replace(definition,needle,replacement);
   needle:='where r->>''accountCode''=''1000''';
   replacement:=$new$where r->>'accountCode'='1000' or exists(
    select 1 from public.financial_chart_custom_accounts opening_cash_account
    where opening_cash_account.organization_id=p_org and opening_cash_account.code=r->>'accountCode'
      and opening_cash_account.reporting_code='1000')$new$;
  else
   needle:='''POLICY_RULES_ONLY''';replacement:='''POLICY_AND_OPENING''';
  end if;
  if strpos(definition,needle)=0 then raise exception 'CHART_OPENING_UPGRADE_SIGNATURE_CHANGED: %',signature;end if;
  definition:=replace(definition,needle,replacement);
  execute definition;
 end loop;
end $$;

notify pgrst,'reload schema';
