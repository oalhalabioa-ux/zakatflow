-- Phase 2a: future posting policies may map to active organization subaccounts.
-- Preserve original fiscal period calculations, the closed-year wrapper, and
-- approved openings. No source events or balances are rewritten.
create function public.financial_chart_posting_accounts(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.financial_opening_can(p_org,'financial_core.view') then raise exception 'CHART_ACCESS_DENIED';end if;
 select coalesce(jsonb_agg(a order by a->>'code'),'[]'::jsonb) into result from (
  select r a from jsonb_array_elements(public.financial_reporting_chart()) r
  union all
  select jsonb_build_object('id',c.code,'code',c.code,'ar',c.name_ar,'en',c.name_en,
   'kind',root.r->>'kind','cash',(root.r->>'cash')::boolean,
   'presentation',root.r->>'presentation','reportingCode',c.reporting_code,
   'parentCode',c.parent_code,'isSystem',false,'isPostable',true,'isActive',true)
  from public.financial_chart_custom_accounts c
  cross join lateral (select r from jsonb_array_elements(public.financial_reporting_chart()) r
    where r->>'code'=c.reporting_code) root
  where c.organization_id=p_org and c.is_active and c.is_postable
 ) chart;
 return result;
end $$;
revoke all on function public.financial_chart_posting_accounts(uuid) from public,anon;
grant execute on function public.financial_chart_posting_accounts(uuid) to authenticated;

-- An account already mapped in a saved policy cannot be disabled or have its
-- financial nature changed; renaming still works and remains audit-tracked.
create function private.financial_chart_guard_policy_reference()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (old.normal_side is distinct from new.normal_side
     or (old.is_active and not new.is_active)
     or (old.is_postable and not new.is_postable))
  and exists(
   select 1 from public.financial_reporting_policies p
   where p.organization_id=old.organization_id and p.status in('DRAFT','APPROVED')
     and exists(select 1 from jsonb_array_elements(p.rules) r
      where r->>'debitAccountId'=old.code or r->>'creditAccountId'=old.code)
  ) then raise exception 'CHART_REFERENCED_BY_POLICY';end if;
 return new;
end $$;
create trigger financial_chart_guard_policy_reference before update on public.financial_chart_custom_accounts
 for each row execute function private.financial_chart_guard_policy_reference();

-- Patch only the chart lookup inside the CURRENT definitions. Earlier fiscal
-- migrations already changed calendar cutoffs, opening vouchers, closing
-- controls and period locks; replacing entire functions would regress them.
do $$
declare signature text;definition text;needle text;replacement text;
begin
 foreach signature in array array[
  'public.financial_reporting_policy_workspace(uuid,date)',
  'public.save_financial_reporting_policy(uuid,date,integer,jsonb,text)',
  'private.financial_statement_live_snapshot_v1(uuid,date,date)',
  'public.financial_chart_workspace(uuid)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if signature='private.financial_statement_live_snapshot_v1(uuid,date,date)' then
   needle:='from jsonb_array_elements(public.financial_reporting_chart()) a;';
   replacement:=$new$from jsonb_array_elements(public.financial_chart_posting_accounts(p_org)) a
    where length(a->>'code')=4 or exists(
      select 1 from jsonb_array_elements(pol.rules) rule
      where rule->>'debitAccountId'=a->>'id' or rule->>'creditAccountId'=a->>'id');$new$;
  elsif signature='public.financial_chart_workspace(uuid)' then
   needle:='''NOT_YET_ACTIVE''';replacement:='''POLICY_RULES_ONLY''';
  else
   needle:='public.financial_reporting_chart()';
   replacement:='public.financial_chart_posting_accounts(p_org)';
  end if;
  if strpos(definition,needle)=0 then raise exception 'CHART_UPGRADE_SIGNATURE_CHANGED: %',signature;end if;
  definition:=replace(definition,needle,replacement);
  execute definition;
 end loop;
end $$;

-- Keep detailed fiscal trial rows for drilldown, but roll up next year's
-- opening to original four-digit control accounts. No detail or balance is
-- copied into a second ledger. Avoid a future-year duplicate on every close.
alter function private.financial_fiscal_trial(jsonb,text) rename to financial_fiscal_trial_detail_v1;
revoke all on function private.financial_fiscal_trial_detail_v1(jsonb,text) from public,anon,authenticated;
create function private.financial_fiscal_trial(p_snapshot jsonb,p_retained text)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb;next_rows jsonb;
begin
 result:=private.financial_fiscal_trial_detail_v1(p_snapshot,p_retained);
 select coalesce(jsonb_agg(jsonb_build_object('accountId',account_id,
  'debit',greatest(amount,0)::numeric(24,4)::text,
  'credit',greatest(-amount,0)::numeric(24,4)::text) order by account_id),'[]'::jsonb)
 into next_rows from (
  select coalesce(a->>'reportingCode',a->>'id') account_id,
   sum((r->>'debit')::numeric-(r->>'credit')::numeric) amount
  from jsonb_array_elements(result->'nextOpening') r
  join lateral (select item a from jsonb_array_elements(p_snapshot->'accounts') item
   where item->>'id'=r->>'accountId') matched on true
  group by coalesce(a->>'reportingCode',a->>'id')
 ) balances;
 if jsonb_array_length(next_rows)<>(select count(distinct coalesce(a->>'reportingCode',a->>'id'))
  from jsonb_array_elements(p_snapshot->'accounts') a where a->>'kind' in('ASSET','LIABILITY','EQUITY')) then
  raise exception 'CHART_FISCAL_ROLLUP_INCOMPLETE';end if;
 return jsonb_set(result,'{nextOpening}',next_rows);
end $$;
revoke all on function private.financial_fiscal_trial(jsonb,text) from public,anon,authenticated;
notify pgrst,'reload schema';
