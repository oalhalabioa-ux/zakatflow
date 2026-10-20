create or replace function public.guard_non_asset_purchase_classification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  type_class text;
begin
  if new.metadata->>'acquisition_mode' = 'PURCHASE' then
    select t.class_code into type_class
    from public.asset_types_v2 t
    where t.code = new.asset_type_code;

    if new.asset_type::text in ('CASH', 'BANK', 'RECEIVABLE')
       or coalesce(type_class, new.asset_class_code) = 'FINANCIAL'
       or new.asset_type_code in ('DEPOSIT', 'PREPAYMENT', 'ADVANCE') then
      raise exception 'ASSET_PURCHASE_CLASSIFICATION_NOT_ALLOWED';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_non_asset_purchase_classification on public.asset_accounts;
create trigger trg_guard_non_asset_purchase_classification
before insert or update of asset_type, asset_class_code, asset_type_code, metadata
on public.asset_accounts
for each row execute function public.guard_non_asset_purchase_classification();

create or replace function public.guard_non_asset_purchase_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  asset_type text;
  asset_class text;
begin
  if new.transaction_type::text = 'PURCHASE' then
    select a.asset_type::text, coalesce(t.class_code, a.asset_class_code)
      into asset_type, asset_class
    from public.asset_accounts a
    left join public.asset_types_v2 t on t.code = a.asset_type_code
    where a.id = new.asset_account_id;

    if asset_type in ('CASH', 'BANK', 'RECEIVABLE')
       or asset_class = 'FINANCIAL' then
      raise exception 'ASSET_PURCHASE_CLASSIFICATION_NOT_ALLOWED';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_non_asset_purchase_transaction on public.transactions;
create trigger trg_guard_non_asset_purchase_transaction
before insert or update of transaction_type, asset_account_id
on public.transactions
for each row execute function public.guard_non_asset_purchase_transaction();
