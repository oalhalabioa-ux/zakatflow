-- Explicit links preserve personal debtor identity without merging equal names,
-- rewriting opening balances, or replacing the existing cash/settlement engines.
create table public.personal_debt_links(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 record_id uuid not null,
 side text not null check(side in('RECEIVABLE','PAYABLE')),
 party_key text not null,
 party_name text not null,
 source_debt_id uuid not null,
 fingerprint text not null,
 created_at timestamptz not null default now(),
 unique(side,record_id)
);
alter table public.personal_debt_links enable row level security;
revoke all on public.personal_debt_links from public,anon,authenticated;
grant select on public.personal_debt_links to authenticated;
create policy personal_debt_links_read on public.personal_debt_links for select to authenticated using(user_id=(select auth.uid()));
create index personal_debt_links_owner on public.personal_debt_links(user_id,party_key);

create function private.linked_personal_debt_command(p jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare uid uuid:=auth.uid();op text:=p->>'operation';cmd jsonb:=p->'command';src uuid:=(cmd->>'source_debt_id')::uuid;
 side_name text;party_name text;party_key text;category_name text;origin_name text;debt_id uuid;r jsonb;prior public.personal_debt_links%rowtype;fp text:=md5(p::text);
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 if src is null or op is null or op not in('FUND','PAYABLE','RECEIVABLE') then raise exception 'PERSONAL_DEBT_SOURCE_INVALID';end if;
 side_name:=case when op='FUND' then cmd->>'side' when op='PAYABLE' then 'PAYABLE' else 'RECEIVABLE' end;
 if side_name is null or side_name not in('RECEIVABLE','PAYABLE') then raise exception 'PERSONAL_DEBT_SOURCE_INVALID';end if;
 if op='FUND' and (cmd->>'action' is distinct from 'FUND' or cmd->>'kind' is distinct from 'LOAN')
 or op='PAYABLE' and cmd->>'action' is distinct from 'CREATE'
 or op='RECEIVABLE' and (cmd->>'scope' is distinct from 'PERSONAL' or cmd->>'type' is distinct from 'RECEIVABLE') then raise exception 'PERSONAL_DEBT_SOURCE_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('linked-personal-debt:'||uid::text,0));
 if side_name='RECEIVABLE' then
  select a.name into party_name from public.asset_accounts a where a.id=src and a.user_id=uid and a.organization_id is null and a.ownership_scope='PERSONAL' and a.asset_type='RECEIVABLE' and coalesce(a.metadata->>'archived','false')<>'true';
  party_key:=src::text;origin_name:='PERSONAL_RECEIVABLE';
 else
  select d.party into party_name from public.personal_payables d where d.id=src and d.user_id=uid and d.cancelled_at is null;
  party_key:='personal-payable:'||lower(trim(party_name));origin_name:='PERSONAL_PAYABLE';
 end if;
 if party_name is null then raise exception 'PERSONAL_DEBT_SOURCE_ACCESS_DENIED';end if;
 -- Advances are distinct economic balances and cannot be appended to ordinary debt.
 if exists(select 1 from public.personal_financings f where f.user_id=uid and f.kind='ADVANCE' and (f.receivable_id=src or f.payable_id=src)) then raise exception 'PERSONAL_DEBT_SOURCE_INVALID';end if;
 select * into prior from public.personal_debt_links l where l.record_id=src and l.side=side_name and l.user_id=uid;
 if prior.id is not null then party_key:=prior.party_key;party_name:=prior.party_name;end if;
 select c.category into category_name from public.financial_debt_categories c where c.owner_id=uid and c.record_id=src and c.origin=origin_name;
 cmd:=cmd-'source_debt_id';
 if op='RECEIVABLE' then
  cmd:=jsonb_set(cmd,'{name}',to_jsonb(party_name));
  if category_name is not null then cmd:=jsonb_set(cmd,'{debt_category}',to_jsonb(category_name));end if;
  if cmd->>'debt_category' is not null then r:=public.open_categorized_receivable(cmd);else r:=public.open_financial_account(cmd);end if;
  debt_id:=(r->>'id')::uuid;
 elsif op='PAYABLE' then
  cmd:=jsonb_set(cmd,'{party}',to_jsonb(party_name));
  if category_name is not null then cmd:=jsonb_set(cmd,'{category}',to_jsonb(category_name));end if;
  if cmd->>'category' is not null then r:=public.personal_payable_categorized_command(cmd);else r:=public.personal_payable_command(cmd);end if;
  debt_id:=(r->>'id')::uuid;
 else
  cmd:=jsonb_set(cmd,'{party}',to_jsonb(party_name));r:=private.personal_financing_command(cmd);
  select case when side_name='RECEIVABLE' then f.receivable_id else f.payable_id end into debt_id from public.personal_financings f where f.id=(r->>'id')::uuid and f.user_id=uid;
 end if;
 if debt_id is null or debt_id=src then raise exception 'PERSONAL_DEBT_LINK_INVALID';end if;
 select * into prior from public.personal_debt_links l where l.record_id=debt_id and l.side=side_name;
 if prior.id is not null then
  if prior.user_id<>uid or prior.fingerprint<>fp then raise exception 'PERSONAL_DEBT_LINK_REQUEST_CONFLICT';end if;
  return r;
 end if;
 insert into public.personal_debt_links(user_id,record_id,side,party_key,party_name,source_debt_id,fingerprint)values(uid,debt_id,side_name,party_key,party_name,src,fp);
 if op='FUND' and category_name is not null then perform public.assign_debt_category(origin_name,debt_id,category_name);end if;
 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data)values(uid,'personal_debt_link',debt_id,'LINK',jsonb_build_object('source_debt_id',src,'party_key',party_key,'operation',op));
 return r;
end $$;
revoke all on function private.linked_personal_debt_command(jsonb) from public,anon;
grant execute on function private.linked_personal_debt_command(jsonb) to authenticated;
create function public.linked_personal_debt_command(p_payload jsonb) returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$ select private.linked_personal_debt_command(p_payload); $$;
revoke all on function public.linked_personal_debt_command(jsonb) from public,anon;
grant execute on function public.linked_personal_debt_command(jsonb) to authenticated;
