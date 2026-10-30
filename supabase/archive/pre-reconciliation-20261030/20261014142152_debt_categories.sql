-- Classification metadata only. Monetary obligations, source events and cash remain unchanged.
create table public.financial_debt_categories(
 origin text not null check(origin in('PERSONAL_RECEIVABLE','PERSONAL_PAYABLE','CORE')),
 record_id uuid not null,owner_id uuid references auth.users(id),organization_id uuid references public.organizations(id),
 category text not null,updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),
 primary key(origin,record_id),
 check((origin='CORE' and organization_id is not null and owner_id is null)or(origin<>'CORE' and owner_id is not null and organization_id is null)),
 check(category in('P_AR_PERSON','P_AR_LOAN','P_AR_RENT','P_AR_ASSET_SALE','P_AR_OTHER','P_AP_PERSON','P_AP_LOAN','P_AP_INSTALLMENT','P_AP_ACCRUAL','P_AP_OTHER','O_AR_CUSTOMER','O_AR_EMPLOYEE','O_AR_LOAN','O_AR_RELATED','O_AR_ACCRUED','O_AR_OTHER','O_AP_SUPPLIER','O_AP_ACCRUAL','O_AP_EMPLOYEE','O_AP_LOAN','O_AP_RELATED','O_AP_OTHER'))
);
create index financial_debt_categories_owner on public.financial_debt_categories(owner_id);
create index financial_debt_categories_org on public.financial_debt_categories(organization_id);
alter table public.financial_debt_categories enable row level security;
revoke all on public.financial_debt_categories from public,anon,authenticated;
grant select on public.financial_debt_categories to authenticated;
create policy debt_category_read on public.financial_debt_categories for select to authenticated using(owner_id=(select auth.uid())or(organization_id is not null and public.financial_core_can(organization_id,'financial_core.view')));

create or replace function private.assign_debt_category(p_origin text,p_record_id uuid,p_category text)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid:=auth.uid();org uuid;side text;scope text;prior text;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 if p_record_id is null or p_origin is null or p_category is null then raise exception 'DEBT_CATEGORY_INVALID';end if;
 if p_origin='PERSONAL_RECEIVABLE' then
  if not exists(select 1 from public.asset_accounts where id=p_record_id and user_id=uid and organization_id is null and ownership_scope='PERSONAL' and asset_type='RECEIVABLE') then raise exception 'DEBT_CATEGORY_ACCESS_DENIED';end if;
  scope:='P';side:='AR';
 elsif p_origin='PERSONAL_PAYABLE' then
  if not exists(select 1 from public.personal_payables where id=p_record_id and user_id=uid and cancelled_at is null) then raise exception 'DEBT_CATEGORY_ACCESS_DENIED';end if;
  scope:='P';side:='AP';
 elsif p_origin='CORE' then
  select o.organization_id,case when o.obligation_type='RECEIVABLE' then 'AR' when o.obligation_type='PAYABLE' then 'AP' else null end into org,side
  from public.financial_event_obligations o join public.financial_events e on e.id=o.event_id and e.organization_id=o.organization_id where o.id=p_record_id and o.adjusts_obligation_id is null and e.status='ACTUAL';
  if org is null or not public.financial_core_can(org,'financial_core.view') or not public.financial_core_can(org,'financial_core.create') then raise exception 'DEBT_CATEGORY_ACCESS_DENIED';end if;
  scope:='O';
 else raise exception 'DEBT_CATEGORY_INVALID';end if;
 if side is null or p_category not in('P_AR_PERSON','P_AR_LOAN','P_AR_RENT','P_AR_ASSET_SALE','P_AR_OTHER','P_AP_PERSON','P_AP_LOAN','P_AP_INSTALLMENT','P_AP_ACCRUAL','P_AP_OTHER','O_AR_CUSTOMER','O_AR_EMPLOYEE','O_AR_LOAN','O_AR_RELATED','O_AR_ACCRUED','O_AR_OTHER','O_AP_SUPPLIER','O_AP_ACCRUAL','O_AP_EMPLOYEE','O_AP_LOAN','O_AP_RELATED','O_AP_OTHER') or p_category not like scope||'_'||side||'_%' then raise exception 'DEBT_CATEGORY_SIDE_MISMATCH';end if;
 select category into prior from public.financial_debt_categories where origin=p_origin and record_id=p_record_id;
 insert into public.financial_debt_categories(origin,record_id,owner_id,organization_id,category,updated_by)
 values(p_origin,p_record_id,case when org is null then uid else null end,org,p_category,uid)
 on conflict(origin,record_id)do update set category=excluded.category,updated_by=excluded.updated_by,updated_at=now();
 insert into public.audit_logs(user_id,entity_type,entity_id,action,old_data,new_data)values(uid,'debt_category',p_record_id,'CLASSIFY',jsonb_build_object('category',prior),jsonb_build_object('origin',p_origin,'category',p_category));
 return jsonb_build_object('category',p_category);
end $$;
revoke all on function private.assign_debt_category(text,uuid,text) from public,anon;
grant execute on function private.assign_debt_category(text,uuid,text) to authenticated;
create or replace function public.assign_debt_category(p_origin text,p_record_id uuid,p_category text)returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$select private.assign_debt_category(p_origin,p_record_id,p_category);$$;
revoke all on function public.assign_debt_category(text,uuid,text) from public,anon;
grant execute on function public.assign_debt_category(text,uuid,text) to authenticated;

create or replace function public.open_categorized_receivable(p_payload jsonb)returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare r jsonb;
begin
 if p_payload->>'scope' is distinct from 'PERSONAL' or p_payload->>'type' is distinct from 'RECEIVABLE' or p_payload->>'debt_category' is null then raise exception 'DEBT_CATEGORY_INVALID';end if;
 r:=public.open_financial_account(p_payload-'debt_category');
 perform public.assign_debt_category('PERSONAL_RECEIVABLE',(r->>'id')::uuid,p_payload->>'debt_category');return r;
end $$;
revoke all on function public.open_categorized_receivable(jsonb) from public,anon;
grant execute on function public.open_categorized_receivable(jsonb) to authenticated;
create or replace function public.personal_payable_categorized_command(p_payload jsonb)returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare r jsonb;
begin
 if p_payload->>'action' is distinct from 'CREATE' or p_payload->>'category' is null then raise exception 'DEBT_CATEGORY_INVALID';end if;
 r:=public.personal_payable_command(p_payload-'category');
 perform public.assign_debt_category('PERSONAL_PAYABLE',(r->>'id')::uuid,p_payload->>'category');return r;
end $$;
revoke all on function public.personal_payable_categorized_command(jsonb) from public,anon;
grant execute on function public.personal_payable_categorized_command(jsonb) to authenticated;
