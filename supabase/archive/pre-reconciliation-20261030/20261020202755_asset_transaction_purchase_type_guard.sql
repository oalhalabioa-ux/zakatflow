create or replace function public.guard_non_asset_purchase_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  asset_type text;
  asset_class text;
  asset_code text;
begin
  if new.transaction_type::text = 'PURCHASE' then
    select a.asset_type::text, coalesce(t.class_code, a.asset_class_code), a.asset_type_code
      into asset_type, asset_class, asset_code
    from public.asset_accounts a
    left join public.asset_types_v2 t on t.code = a.asset_type_code
    where a.id = new.asset_account_id;

    if asset_type in ('CASH', 'BANK', 'RECEIVABLE')
       or asset_class = 'FINANCIAL'
       or asset_code in ('DEPOSIT', 'PREPAYMENT', 'ADVANCE') then
      raise exception 'ASSET_PURCHASE_CLASSIFICATION_NOT_ALLOWED';
    end if;
  end if;
  return new;
end;
$$;
