-- Narrow asset register update. The row and its audit entry commit together.
create function public.edit_asset_details(
  p_asset_id uuid,
  p_expected_updated_at timestamptz,
  p_name text,
  p_market_price numeric default null
)
returns public.asset_accounts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  previous public.asset_accounts;
  saved public.asset_accounts;
  next_metadata jsonb;
  basis_quantity numeric;
  valuation_currency text;
  trimmed_name text := btrim(p_name);
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  if trimmed_name is null or trimmed_name !~ '[^[:space:]]' or length(trimmed_name) > 120 then
    raise exception 'ASSET_EDIT_NAME_INVALID';
  end if;

  select * into previous from public.asset_accounts where id = p_asset_id;
  if not found then raise exception 'ASSET_NOT_FOUND'; end if;
  if previous.ownership_scope = 'ORGANIZATION'
    and not public.has_organization_permission(previous.organization_id, 'assets.edit') then
    raise exception 'ASSET_EDIT_ACCESS_DENIED';
  end if;
  if previous.updated_at is distinct from p_expected_updated_at then
    raise exception 'ASSET_EDIT_CONFLICT';
  end if;

  next_metadata := previous.metadata;
  if p_market_price is not null then
    if previous.asset_type not in ('GOLD', 'SILVER', 'STOCK')
      or previous.metadata->>'investment_id' is not null
      or previous.metadata->>'acquisition_mode' = 'INVESTMENT' then
      raise exception 'ASSET_EDIT_VALUATION_UNSUPPORTED';
    end if;
    if p_market_price < 0 or p_market_price > 9999999999999999.99999999
      or p_market_price <> round(p_market_price, 8) then
      raise exception 'ASSET_EDIT_PRICE_INVALID';
    end if;
    -- Stored totals use the original quantity. Live valuation uses remaining lots.
    select sum(original_quantity) into basis_quantity
      from public.lots where asset_account_id = previous.id;
    if basis_quantity is null and jsonb_typeof(previous.metadata->'quantity') = 'number' then
      basis_quantity := (previous.metadata->>'quantity')::numeric;
    end if;
    valuation_currency := coalesce(nullif(previous.metadata->>'market_price_currency', ''), previous.currency);
    next_metadata := next_metadata || jsonb_build_object(
      'market_price', p_market_price,
      'market_price_per_unit', p_market_price,
      'market_price_currency', valuation_currency,
      'market_price_source', 'USER_MANUAL',
      'market_valuation_date', (statement_timestamp() at time zone 'Asia/Riyadh')::date,
      'market_value_auto', false
    );
    if basis_quantity is not null and basis_quantity >= 0 then
      next_metadata := next_metadata || jsonb_build_object(
        'market_value', basis_quantity * p_market_price,
        'estimated_value', basis_quantity * p_market_price
      );
    end if;
  end if;

  if previous.name = trimmed_name and previous.metadata = next_metadata then return previous; end if;

  update public.asset_accounts
  set name = trimmed_name, metadata = next_metadata,
      updated_at = greatest(clock_timestamp(), previous.updated_at + interval '1 microsecond')
  where id = previous.id and updated_at = previous.updated_at
  returning * into saved;
  if not found then raise exception 'ASSET_EDIT_CONFLICT'; end if;

  insert into public.audit_logs (user_id, entity_type, entity_id, action, old_data, new_data)
  values (actor, 'asset_account', previous.id, 'UPDATE_ASSET_DETAILS', to_jsonb(previous), to_jsonb(saved));
  return saved;
end;
$$;
revoke all on function public.edit_asset_details(uuid, timestamptz, text, numeric) from public, anon;
grant execute on function public.edit_asset_details(uuid, timestamptz, text, numeric) to authenticated;
