create table if not exists public.liquidity_intercompany_transfers (
  id uuid primary key default gen_random_uuid(),
  holding_organization_id uuid not null references public.organizations(id) on delete cascade,
  source_organization_id uuid not null references public.organizations(id) on delete restrict,
  destination_organization_id uuid not null references public.organizations(id) on delete restrict,
  source_account_id uuid not null,
  destination_account_id uuid,
  transaction_type text not null check (transaction_type in ('LOAN','CAPITAL','ON_BEHALF')),
  source_amount numeric(24,4) not null check (source_amount > 0),
  source_currency text not null references public.currencies(code),
  source_base_amount numeric(24,4) not null check (source_base_amount > 0),
  destination_amount numeric(24,4) not null check (destination_amount > 0),
  destination_currency text not null references public.currencies(code),
  destination_base_amount numeric(24,4) not null check (destination_base_amount > 0),
  exchange_rate numeric(24,10) not null check (exchange_rate > 0),
  fx_difference_base numeric(24,4) not null default 0,
  transfer_date date not null,
  reference text not null default '',
  notes text not null default '',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  constraint liquidity_intercompany_distinct_accounts check (source_account_id <> destination_account_id),
  constraint liquidity_intercompany_source_account_org_fk foreign key (source_account_id, source_organization_id)
    references public.liquidity_accounts(id, organization_id) on delete restrict,
  constraint liquidity_intercompany_destination_account_org_fk foreign key (destination_account_id, destination_organization_id)
    references public.liquidity_accounts(id, organization_id) on delete restrict,
  constraint liquidity_intercompany_distinct_entities check (source_organization_id <> destination_organization_id)
);

alter table public.liquidity_flows
  add column if not exists intercompany_transfer_id uuid references public.liquidity_intercompany_transfers(id) on delete cascade;
create index if not exists liquidity_intercompany_holding_date_idx
  on public.liquidity_intercompany_transfers(holding_organization_id, transfer_date desc);
create index if not exists liquidity_flows_intercompany_transfer_idx
  on public.liquidity_flows(intercompany_transfer_id) where intercompany_transfer_id is not null;
create unique index if not exists liquidity_flows_intercompany_direction_unique
  on public.liquidity_flows(intercompany_transfer_id, direction) where intercompany_transfer_id is not null;

alter table public.liquidity_intercompany_transfers enable row level security;
create policy liquidity_intercompany_member_read on public.liquidity_intercompany_transfers
  for select to authenticated using (public.is_organization_member(holding_organization_id));
revoke insert, update, delete on public.liquidity_intercompany_transfers from authenticated;
grant select on public.liquidity_intercompany_transfers to authenticated;
revoke insert (intercompany_transfer_id) on public.liquidity_flows from authenticated;
drop policy if exists liquidity_flows_update on public.liquidity_flows;
create policy liquidity_flows_update on public.liquidity_flows for update to authenticated
  using (private.can_write_liquidity(organization_id) and transfer_id is null and intercompany_transfer_id is null)
  with check (private.can_write_liquidity(organization_id) and transfer_id is null and intercompany_transfer_id is null);
drop policy if exists liquidity_flows_delete on public.liquidity_flows;
create policy liquidity_flows_delete on public.liquidity_flows for delete to authenticated
  using (private.can_write_liquidity(organization_id) and transfer_id is null and intercompany_transfer_id is null);

create or replace function private.create_liquidity_intercompany_transfer_atomic(
  p_holding_organization_id uuid,
  p_source_organization_id uuid,
  p_source_account_id uuid,
  p_destination_organization_id uuid,
  p_destination_account_id uuid,
  p_transaction_type text,
  p_source_amount numeric,
  p_destination_amount numeric,
  p_source_base_amount numeric,
  p_destination_base_amount numeric,
  p_exchange_rate numeric,
  p_transfer_date date,
  p_source_title text,
  p_destination_title text,
  p_reference text default '',
  p_notes text default ''
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_source public.liquidity_accounts%rowtype;
  v_destination public.liquidity_accounts%rowtype;
  v_holding public.organizations%rowtype;
  v_source_org public.organizations%rowtype;
  v_destination_org public.organizations%rowtype;
  v_transfer_id uuid := gen_random_uuid();
  v_source_flow_id uuid;
  v_destination_flow_id uuid;
  v_source_group_id uuid;
  v_destination_group_id uuid;
  v_flow_type text;
begin
  if v_user_id is null then raise exception 'UNAUTHORIZED'; end if;
  if p_source_organization_id = p_destination_organization_id then raise exception 'INTERCOMPANY_ENTITIES_MUST_DIFFER'; end if;
  if p_transaction_type not in ('LOAN','CAPITAL','ON_BEHALF') then raise exception 'INTERCOMPANY_TYPE_INVALID'; end if;
  if p_source_amount <= 0 or p_destination_amount <= 0 or p_source_base_amount <= 0 or p_destination_base_amount <= 0 or p_exchange_rate <= 0 then
    raise exception 'TRANSFER_AMOUNTS_AND_RATES_MUST_BE_POSITIVE';
  end if;
  if p_transfer_date is null then raise exception 'TRANSFER_DATE_REQUIRED'; end if;
  if not private.can_write_liquidity(p_holding_organization_id)
    or not private.can_write_liquidity(p_source_organization_id)
    or not private.can_write_liquidity(p_destination_organization_id) then
    raise exception 'ORGANIZATION_ADMIN_REQUIRED';
  end if;

  select * into v_holding from public.organizations where id = p_holding_organization_id and organization_kind = 'HOLDING';
  select * into v_source_org from public.organizations where id = p_source_organization_id;
  select * into v_destination_org from public.organizations where id = p_destination_organization_id;
  if v_holding.id is null or v_source_org.id is null or v_destination_org.id is null then raise exception 'INTERCOMPANY_ORGANIZATION_NOT_FOUND'; end if;
  if not ((v_source_org.id = v_holding.id or v_source_org.parent_organization_id = v_holding.id)
      and (v_destination_org.id = v_holding.id or v_destination_org.parent_organization_id = v_holding.id)) then
    raise exception 'INTERCOMPANY_ORGANIZATIONS_MUST_SHARE_HOLDING';
  end if;
  if p_transaction_type = 'ON_BEHALF' and p_destination_account_id is not null then raise exception 'ON_BEHALF_MUST_NOT_USE_DESTINATION_BANK_ACCOUNT'; end if;
  if p_transaction_type <> 'ON_BEHALF' and p_destination_account_id is null then raise exception 'DESTINATION_ACCOUNT_REQUIRED'; end if;
  if p_source_account_id = p_destination_account_id then raise exception 'TRANSFER_ACCOUNTS_MUST_DIFFER'; end if;
  perform a.id from public.liquidity_accounts a where a.id in (p_source_account_id,p_destination_account_id) order by a.id for update;
  select * into v_source from public.liquidity_accounts where id = p_source_account_id and organization_id = p_source_organization_id and active;
  select * into v_destination from public.liquidity_accounts where id = p_destination_account_id and organization_id = p_destination_organization_id and active;
  if v_source.id is null then raise exception 'TRANSFER_ACCOUNT_NOT_FOUND'; end if;
  if p_transaction_type <> 'ON_BEHALF' and v_destination.id is null then raise exception 'TRANSFER_ACCOUNT_NOT_FOUND'; end if;

  v_flow_type := case p_transaction_type when 'LOAN' then 'FINANCING' when 'CAPITAL' then 'INVESTMENT' else 'OPERATING' end;
  v_source_group_id := v_source.entity_id;
  v_destination_group_id := v_destination.entity_id;
  insert into public.liquidity_intercompany_transfers (
    id, holding_organization_id, source_organization_id, destination_organization_id,
    source_account_id, destination_account_id, transaction_type,
    source_amount, source_currency, source_base_amount, destination_amount, destination_currency, destination_base_amount,
    exchange_rate, fx_difference_base, transfer_date, reference, notes, created_by
  ) values (
    v_transfer_id, p_holding_organization_id, p_source_organization_id, p_destination_organization_id,
    v_source.id, v_destination.id, p_transaction_type,
    round(p_source_amount,4), v_source.currency, round(p_source_base_amount,4),
    round(p_destination_amount,4), case when p_transaction_type = 'ON_BEHALF' then v_destination_org.base_currency else v_destination.currency end, round(p_destination_base_amount,4),
    p_exchange_rate, round(p_destination_base_amount-p_source_base_amount,4), p_transfer_date,
    coalesce(p_reference,''), coalesce(p_notes,''), v_user_id
  );
  insert into public.liquidity_flows (
    organization_id, entity_id, account_id, intercompany_transfer_id, direction, flow_type, title, counterparty,
    due_date, amount, currency, base_amount, status, source, reference, notes, created_by
  ) values (
    p_source_organization_id, v_source_group_id, v_source.id, v_transfer_id, 'OUTFLOW', v_flow_type,
    coalesce(nullif(trim(p_source_title),''),'Transfer to '||v_destination_org.name), v_destination_org.name, p_transfer_date,
    round(p_source_amount,4), v_source.currency, round(p_source_base_amount,4), 'ACTUAL', 'MANUAL',
    coalesce(p_reference,''), coalesce(p_notes,''), v_user_id
  ) returning id into v_source_flow_id;
  if p_transaction_type <> 'ON_BEHALF' then
    insert into public.liquidity_flows (
      organization_id, entity_id, account_id, intercompany_transfer_id, direction, flow_type, title, counterparty,
      due_date, amount, currency, base_amount, status, source, reference, notes, created_by
    ) values (
      p_destination_organization_id, v_destination_group_id, v_destination.id, v_transfer_id, 'INFLOW', v_flow_type,
      coalesce(nullif(trim(p_destination_title),''),'Transfer from '||v_source_org.name), v_source_org.name, p_transfer_date,
      round(p_destination_amount,4), v_destination.currency, round(p_destination_base_amount,4), 'ACTUAL', 'MANUAL',
      coalesce(p_reference,''), coalesce(p_notes,''), v_user_id
    ) returning id into v_destination_flow_id;
  end if;
  update public.liquidity_accounts set current_balance=current_balance-round(p_source_amount,4),
    current_balance_base=current_balance_base-round(p_source_base_amount,4), updated_at=now() where id=v_source.id;
  if p_transaction_type <> 'ON_BEHALF' then
    update public.liquidity_accounts set current_balance=current_balance+round(p_destination_amount,4),
      current_balance_base=current_balance_base+round(p_destination_base_amount,4), updated_at=now() where id=v_destination.id;
  end if;
  return jsonb_build_object('intercompany_transfer_id',v_transfer_id,'source_flow_id',v_source_flow_id,
    'destination_flow_id',v_destination_flow_id,'fx_difference_base',round(p_destination_base_amount-p_source_base_amount,4));
end $$;

create or replace function private.delete_liquidity_intercompany_transfer_atomic(p_transfer_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_transfer public.liquidity_intercompany_transfers%rowtype;
begin
  select * into v_transfer from public.liquidity_intercompany_transfers where id=p_transfer_id for update;
  if v_transfer.id is null then raise exception 'INTERCOMPANY_TRANSFER_NOT_FOUND'; end if;
  if not private.can_write_liquidity(v_transfer.holding_organization_id)
    or not private.can_write_liquidity(v_transfer.source_organization_id)
    or not private.can_write_liquidity(v_transfer.destination_organization_id) then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
  perform a.id from public.liquidity_accounts a where a.id in (v_transfer.source_account_id,v_transfer.destination_account_id) order by a.id for update;
  update public.liquidity_accounts set current_balance=current_balance+v_transfer.source_amount,
    current_balance_base=current_balance_base+v_transfer.source_base_amount, updated_at=now() where id=v_transfer.source_account_id;
  if v_transfer.destination_account_id is not null then
    update public.liquidity_accounts set current_balance=current_balance-v_transfer.destination_amount,
      current_balance_base=current_balance_base-v_transfer.destination_base_amount, updated_at=now() where id=v_transfer.destination_account_id;
  end if;
  delete from public.liquidity_intercompany_transfers where id=p_transfer_id;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.create_liquidity_intercompany_transfer(
  p_holding_organization_id uuid, p_source_organization_id uuid, p_source_account_id uuid,
  p_destination_organization_id uuid, p_destination_account_id uuid, p_transaction_type text,
  p_source_amount numeric, p_destination_amount numeric, p_source_base_amount numeric,
  p_destination_base_amount numeric, p_exchange_rate numeric, p_transfer_date date,
  p_source_title text, p_destination_title text, p_reference text default '', p_notes text default ''
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.create_liquidity_intercompany_transfer_atomic($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16);
$$;
create or replace function public.delete_liquidity_intercompany_transfer(p_transfer_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.delete_liquidity_intercompany_transfer_atomic($1);
$$;
revoke all on function private.create_liquidity_intercompany_transfer_atomic(uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,date,text,text,text,text) from public,anon;
revoke all on function private.delete_liquidity_intercompany_transfer_atomic(uuid) from public,anon;
revoke all on function public.create_liquidity_intercompany_transfer(uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,date,text,text,text,text) from public,anon;
revoke all on function public.delete_liquidity_intercompany_transfer(uuid) from public,anon;
grant execute on function private.create_liquidity_intercompany_transfer_atomic(uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,date,text,text,text,text) to authenticated;
grant execute on function private.delete_liquidity_intercompany_transfer_atomic(uuid) to authenticated;
grant execute on function public.create_liquidity_intercompany_transfer(uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,date,text,text,text,text) to authenticated;
grant execute on function public.delete_liquidity_intercompany_transfer(uuid) to authenticated;
