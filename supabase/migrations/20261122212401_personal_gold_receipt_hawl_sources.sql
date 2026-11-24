-- Preserve source evidence for new personal gold sales. The existing receipt
-- and cash lot remain the financial ledger and the assessment path is unchanged.
create table private.personal_gold_receipt_hawl_sources (
  receipt_id uuid not null references public.transactions(id) on delete cascade,
  receipt_lot_id uuid not null references public.lots(id) on delete cascade,
  source_lot_id uuid not null references public.lots(id),
  user_id uuid not null references public.profiles(id),
  source_order integer not null check (source_order > 0),
  sold_quantity numeric(24,8) not null check (sold_quantity > 0),
  source_hawl_start_date date,
  continuity_applies boolean not null,
  primary key (receipt_id, source_lot_id),
  unique (receipt_id, source_order)
);
alter table private.personal_gold_receipt_hawl_sources enable row level security;
revoke all on private.personal_gold_receipt_hawl_sources from public, anon, authenticated, service_role;
create index personal_gold_receipt_hawl_receipt_lot_idx
  on private.personal_gold_receipt_hawl_sources(receipt_lot_id);
create index personal_gold_receipt_hawl_source_lot_idx
  on private.personal_gold_receipt_hawl_sources(source_lot_id);

create function private.capture_personal_gold_receipt_hawl_sources()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  gold_sale record;
  allocated_quantity numeric;
  all_personal_gold boolean;
begin
  if new.user_id is distinct from auth.uid() or new.organization_id is not null
    or new.metadata->>'source' is distinct from 'sale_proceeds' then
    return new;
  end if;

  select sale.id, sale.quantity, cash.is_zakatable,
    coalesce(settings.zakatable_conversion_continuity, true) as continuity_enabled
  into gold_sale
  from public.transactions receipt
  join public.transactions sale on sale.id::text=receipt.metadata->>'sale_transaction_id'
    and sale.user_id=receipt.user_id and sale.transfer_id=receipt.transfer_id
  join public.asset_accounts gold on gold.id=sale.asset_account_id and gold.user_id=sale.user_id
  join public.asset_accounts cash on cash.id=receipt.asset_account_id and cash.user_id=receipt.user_id
  left join public.user_settings settings on settings.user_id=sale.user_id
  where receipt.id=new.source_transaction_id and receipt.user_id=new.user_id
    and receipt.transaction_type='ADD' and receipt.organization_id is null
    and receipt.metadata->>'source'='sale_proceeds'
    and sale.id::text=new.metadata->>'sale_transaction_id'
    and sale.transaction_type='SALE' and sale.organization_id is null
    and sale.metadata->>'proceeds_account_id'=cash.id::text
    and gold.organization_id is null and gold.ownership_scope='PERSONAL' and gold.asset_type='GOLD'
    and cash.id=new.asset_account_id and cash.organization_id is null
    and cash.ownership_scope='PERSONAL' and cash.asset_type in ('BANK','CASH')
    and receipt.quantity=new.original_quantity and receipt.base_value=new.original_value_base
    and receipt.transaction_date=new.acquisition_date;
  if not found then return new; end if;

  select sum(allocation.quantity), bool_and(source.organization_id is null
    and account.organization_id is null and account.ownership_scope='PERSONAL' and account.asset_type='GOLD')
  into allocated_quantity, all_personal_gold
  from public.transaction_allocations allocation
  join public.lots source on source.id=allocation.lot_id and source.user_id=allocation.user_id
  join public.asset_accounts account on account.id=source.asset_account_id and account.user_id=source.user_id
  where allocation.transaction_id=gold_sale.id and allocation.user_id=new.user_id;
  if allocated_quantity is distinct from gold_sale.quantity or all_personal_gold is distinct from true then
    raise exception 'SALE_HAWL_SOURCE_ALLOCATION_MISMATCH';
  end if;

  insert into private.personal_gold_receipt_hawl_sources(
    receipt_id, receipt_lot_id, source_lot_id, user_id, source_order, sold_quantity,
    source_hawl_start_date, continuity_applies
  )
  select new.source_transaction_id, new.id, source.id, new.user_id,
    row_number() over (order by source.acquisition_date,source.created_at,source.id),
    allocation.quantity, source.hawl_start_date,
    gold_sale.continuity_enabled and gold_sale.is_zakatable and account.is_zakatable
  from public.transaction_allocations allocation
  join public.lots source on source.id=allocation.lot_id and source.user_id=allocation.user_id
  join public.asset_accounts account on account.id=source.asset_account_id and account.user_id=source.user_id
  where allocation.transaction_id=gold_sale.id and allocation.user_id=new.user_id;

  return new;
end;
$$;
revoke all on function private.capture_personal_gold_receipt_hawl_sources() from public, anon, authenticated, service_role;
create trigger capture_personal_gold_receipt_hawl_sources
after insert on public.lots
for each row execute function private.capture_personal_gold_receipt_hawl_sources();

-- Uses the latest amount on the same lot after a price amendment. Cumulative
-- rounding makes the per-source proceeds reconcile exactly to the receipt.
-- This reader describes the receipt only, not transferred balances or eligibility.
create function public.personal_gold_receipt_hawl_sources(p_receipt_id uuid)
returns table (
  source_lot_id uuid, source_order integer, sold_quantity numeric,
  proceeds numeric, proceeds_base numeric, currency text, base_currency text,
  inherited_hawl_start_date date, continuity_status text, reversed boolean
)
language sql stable security definer set search_path='' as $$
  with sources as (
    select evidence.*, cash.original_quantity, cash.original_value_base,
      receipt.currency, receipt.base_currency,
      exists(select 1 from public.transactions reversal where reversal.user_id=evidence.user_id
        and reversal.reversal_of_transaction_id=receipt.id) as reversed,
      sum(evidence.sold_quantity) over (partition by cash.id order by evidence.source_order) as running,
      sum(evidence.sold_quantity) over (partition by cash.id) as total
    from private.personal_gold_receipt_hawl_sources evidence
    join public.lots cash on cash.id=evidence.receipt_lot_id and cash.user_id=evidence.user_id
    join public.transactions receipt on receipt.id=evidence.receipt_id and receipt.id=cash.source_transaction_id
      and receipt.user_id=evidence.user_id
    where evidence.user_id=(select auth.uid()) and receipt.id=p_receipt_id
      and receipt.organization_id is null and cash.organization_id is null
      and receipt.quantity=cash.original_quantity and receipt.base_value=cash.original_value_base
  )
  select s.source_lot_id, s.source_order, s.sold_quantity,
    round(s.original_quantity*s.running/s.total,8)
      - round(s.original_quantity*(s.running-s.sold_quantity)/s.total,8),
    round(s.original_value_base*s.running/s.total,8)
      - round(s.original_value_base*(s.running-s.sold_quantity)/s.total,8),
    s.currency, s.base_currency,
    case when s.continuity_applies then s.source_hawl_start_date end,
    case
      when not s.continuity_applies then 'NOT_APPLICABLE'
      when s.source_hawl_start_date is null then 'SOURCE_HAWL_UNKNOWN'
      else 'SOURCE_RECORDED'
    end,
    s.reversed
  from sources s order by s.source_order;
$$;
revoke all on function public.personal_gold_receipt_hawl_sources(uuid) from public, anon, authenticated, service_role;
grant execute on function public.personal_gold_receipt_hawl_sources(uuid) to authenticated;
