-- Party metadata is independent of monetary records. Existing personal identity
-- keys remain unchanged; aliases do not rewrite invoices or opening balances.
create table public.personal_debt_parties (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 party_key text not null,
 name text not null check(length(trim(name)) between 1 and 120),
 party_type text not null default 'BOTH' check(party_type in ('CUSTOMER','SUPPLIER','BOTH','PERSON','OTHER')),
 contact_name text not null default '', phone text not null default '',
 email text not null default '', notes text not null default '',
 active boolean not null default true,
 updated_at timestamptz not null default now(),
 unique(user_id,party_key)
);
alter table public.personal_debt_parties enable row level security;
revoke all on public.personal_debt_parties from public,anon,authenticated;
grant select on public.personal_debt_parties to authenticated;
create policy personal_debt_parties_owner_read on public.personal_debt_parties
 for select to authenticated using(user_id=(select auth.uid()));

-- Deliberately private/definer: the guarded metadata command must see all
-- financial references, including records hidden by other module permissions.
create function private.manage_personal_debt_party(p jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare uid uuid:=auth.uid(); k text:=p->>'party_key'; r public.personal_debt_parties%rowtype;
 linked boolean; n text:=trim(p->>'name'); t text:=coalesce(p->>'party_type','BOTH');
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 perform pg_advisory_xact_lock(hashtextextended('personal-party:'||uid::text,0));
 if p->>'id' is not null then
  select * into r from public.personal_debt_parties where id=(p->>'id')::uuid and user_id=uid for update;
  if r.id is null then raise exception 'PARTY_ACCESS_DENIED';end if;k:=r.party_key;
 end if;
 if k is null then k:='directory:'||gen_random_uuid()::text;end if;
 linked:=exists(select 1 from public.asset_accounts where user_id=uid and organization_id is null and asset_type='RECEIVABLE' and id::text=k)
  or exists(select 1 from public.personal_payables where user_id=uid and 'personal-payable:'||lower(trim(party))=k)
  or exists(select 1 from public.personal_debt_links where user_id=uid and party_key=k);
 if r.id is null and p->>'party_key' is not null and not linked then raise exception 'PARTY_ACCESS_DENIED';end if;
 if p->>'action'='DELETE' then
  if r.id is null then raise exception 'PARTY_ACCESS_DENIED';end if;
  if linked then raise exception 'PARTY_IN_USE';end if;
  delete from public.personal_debt_parties where id=r.id and user_id=uid;return jsonb_build_object('deleted',true);
 end if;
 if p->>'action' is distinct from 'SAVE' or n is null or length(n) not between 1 and 120
  or t not in ('CUSTOMER','SUPPLIER','BOTH','PERSON','OTHER')
  or length(coalesce(p->>'contact_name',''))>120 or length(coalesce(p->>'phone',''))>40
  or length(coalesce(p->>'email',''))>160 or length(coalesce(p->>'notes',''))>500 then raise exception 'VALIDATION_FAILED';end if;
 insert into public.personal_debt_parties(user_id,party_key,name,party_type,contact_name,phone,email,notes,active)
 values(uid,k,n,t,coalesce(p->>'contact_name',''),coalesce(p->>'phone',''),coalesce(p->>'email',''),coalesce(p->>'notes',''),coalesce((p->>'active')::boolean,true))
 on conflict(user_id,party_key) do update set name=excluded.name,party_type=excluded.party_type,contact_name=excluded.contact_name,phone=excluded.phone,email=excluded.email,notes=excluded.notes,active=excluded.active,updated_at=now()
 returning * into r;
 return to_jsonb(r)-'user_id';
end $$;
revoke all on function private.manage_personal_debt_party(jsonb) from public,anon;
grant execute on function private.manage_personal_debt_party(jsonb) to authenticated;
create function public.manage_personal_debt_party(p_payload jsonb) returns jsonb
language sql security invoker set search_path=pg_catalog,public,private as $$select private.manage_personal_debt_party(p_payload)$$;
revoke all on function public.manage_personal_debt_party(jsonb) from public,anon;
grant execute on function public.manage_personal_debt_party(jsonb) to authenticated;

-- Atomically create the ordinary monetary command and link it to a directory
-- identity. Existing engines retain date, balance, reversal and replay checks.
create function private.directory_personal_debt_command(p jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare uid uuid:=auth.uid();cmd jsonb:=p->'command';op text:=p->>'operation';
 party public.personal_debt_parties%rowtype;side_name text;result jsonb;rid uuid;prior public.personal_debt_links%rowtype;fp text:=md5(p::text);
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 perform pg_advisory_xact_lock(hashtextextended('personal-party:'||uid::text,0));
 select * into party from public.personal_debt_parties where id=substring(cmd->>'source_debt_id' from 7)::uuid and user_id=uid for update;
 if party.id is null then raise exception 'PARTY_ACCESS_DENIED';end if;
 if not party.active then raise exception 'PARTY_ARCHIVED';end if;
 side_name:=case op when 'RECEIVABLE' then 'RECEIVABLE' when 'PAYABLE' then 'PAYABLE' when 'FUND' then cmd->>'side' end;
 if side_name is null or side_name not in ('RECEIVABLE','PAYABLE') then raise exception 'PERSONAL_DEBT_SOURCE_INVALID';end if;
 cmd:=cmd-'source_debt_id';
 if op='RECEIVABLE' and cmd->>'scope'='PERSONAL' and cmd->>'type'='RECEIVABLE' then
  cmd:=jsonb_set(cmd,'{name}',to_jsonb(party.name));
  if cmd->>'debt_category' is not null then result:=public.open_categorized_receivable(cmd);else result:=public.open_financial_account(cmd);end if;rid:=(result->>'id')::uuid;
 elsif op='PAYABLE' and cmd->>'action'='CREATE' then
  cmd:=jsonb_set(cmd,'{party}',to_jsonb(party.name));
  if cmd->>'category' is not null then result:=public.personal_payable_categorized_command(cmd);else result:=public.personal_payable_command(cmd);end if;rid:=(result->>'id')::uuid;
 elsif op='FUND' and cmd->>'action'='FUND' and cmd->>'kind'='LOAN' then
  cmd:=jsonb_set(cmd,'{party}',to_jsonb(party.name));result:=private.personal_financing_command(cmd);
  select case when side_name='RECEIVABLE' then receivable_id else payable_id end into rid from public.personal_financings where id=(result->>'id')::uuid and user_id=uid;
 else raise exception 'PERSONAL_DEBT_SOURCE_INVALID';end if;
 if rid is null then raise exception 'PERSONAL_DEBT_LINK_INVALID';end if;
 select * into prior from public.personal_debt_links where side=side_name and record_id=rid;
 if prior.id is not null then
  if prior.user_id<>uid or prior.fingerprint<>fp then raise exception 'PERSONAL_DEBT_LINK_REQUEST_CONFLICT';end if;
 else
  insert into public.personal_debt_links(user_id,record_id,side,party_key,party_name,source_debt_id,fingerprint)
  values(uid,rid,side_name,party.party_key,party.name,rid,fp);
 end if;
 return result;
end $$;
revoke all on function private.directory_personal_debt_command(jsonb) from public,anon;
grant execute on function private.directory_personal_debt_command(jsonb) to authenticated;
create function public.directory_personal_debt_command(p_payload jsonb) returns jsonb
language sql security invoker set search_path=pg_catalog,public,private as $$select private.directory_personal_debt_command(p_payload)$$;
revoke all on function public.directory_personal_debt_command(jsonb) from public,anon;
grant execute on function public.directory_personal_debt_command(jsonb) to authenticated;

-- A delete never clears links or silently strands the subledger. The added
-- constraints also serialize concurrent inserts against parent deletion.
alter table public.liquidity_flows add constraint liquidity_flows_party_directory_restrict_fk
 foreign key(counterparty_id,organization_id) references public.liquidity_counterparties(id,organization_id) on delete restrict not valid;
alter table public.financial_events add constraint financial_events_party_directory_fk
 foreign key(counterparty_id,organization_id) references public.liquidity_counterparties(id,organization_id) on delete restrict not valid;
alter table public.financial_vat_counterparty_map add constraint financial_vat_party_directory_fk
 foreign key(counterparty_id,organization_id) references public.liquidity_counterparties(id,organization_id) on delete restrict not valid;
create function private.guard_counterparty_delete() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if exists(select 1 from public.liquidity_flows where counterparty_id=old.id)
 or exists(select 1 from public.financial_events where counterparty_id=old.id)
 or exists(select 1 from public.debt_contracts where counterparty_id=old.id)
 or exists(select 1 from public.participation_contracts where counterparty_id=old.id)
 or exists(select 1 from public.financial_vat_counterparty_map where counterparty_id=old.id) then raise exception 'PARTY_IN_USE';end if;
 return old;
end $$;
revoke all on function private.guard_counterparty_delete() from public,anon,authenticated;
create trigger guard_counterparty_delete before delete on public.liquidity_counterparties
 for each row execute function private.guard_counterparty_delete();

create function private.guard_archived_debt_party() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare enabled boolean;
begin
 if tg_table_name='personal_debt_links' then
  select active into enabled from public.personal_debt_parties where user_id=new.user_id and party_key=new.party_key for share;
  if enabled=false then raise exception 'PARTY_ARCHIVED';end if;
 elsif new.counterparty_id is not null then
  if tg_op='UPDATE' and new.counterparty_id is not distinct from old.counterparty_id and new.organization_id is not distinct from old.organization_id then return new;end if;
  select active into enabled from public.liquidity_counterparties where id=new.counterparty_id and organization_id=new.organization_id for share;
  if enabled=false then raise exception 'PARTY_ARCHIVED';end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_archived_debt_party() from public,anon,authenticated;
create trigger guard_archived_personal_party before insert on public.personal_debt_links for each row execute function private.guard_archived_debt_party();
create trigger guard_archived_party before insert or update of counterparty_id,organization_id on public.financial_events for each row execute function private.guard_archived_debt_party();
create trigger guard_archived_party before insert or update of counterparty_id,organization_id on public.debt_contracts for each row execute function private.guard_archived_debt_party();
create trigger guard_archived_party before insert or update of counterparty_id,organization_id on public.participation_contracts for each row execute function private.guard_archived_debt_party();
create trigger guard_archived_party before insert or update of counterparty_id,organization_id on public.liquidity_flows for each row execute function private.guard_archived_debt_party();
