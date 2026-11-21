-- Registration locks and market valuation eligibility are independent.
create function public.asset_edit_availability(p_asset_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  asset public.asset_accounts;
  actor uuid := auth.uid();
  initial_id uuid;
  movement public.transactions;
  assessment_id uuid;
  assessment_date date;
  linked_operation record;
  registered_scope boolean;
  can_write boolean;
  valuation_mode text;
  reason jsonb;
  book jsonb;
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  select * into asset from public.asset_accounts where id = p_asset_id;
  if not found or (asset.ownership_scope = 'PERSONAL' and asset.user_id is distinct from actor)
     or (asset.ownership_scope = 'ORGANIZATION'
       and public.has_organization_permission(asset.organization_id, 'assets.view') is not true) then
    raise exception 'ASSET_NOT_FOUND';
  end if;

  registered_scope := asset.status = 'ACTIVE' and asset.metadata->>'archived' is distinct from 'true'
    and not (asset.metadata ?| array['investment_id','register_source','financing_contract_id','personal_contract_id'])
    and asset.metadata->>'acquisition_mode' is distinct from 'INVESTMENT';
  can_write := registered_scope and (asset.ownership_scope = 'PERSONAL'
    or public.has_organization_permission(asset.organization_id, 'assets.edit') is true);

  if can_write and (asset.asset_type in ('GOLD','SILVER','STOCK','REAL_ESTATE','INVENTORY')
     or (asset.asset_type = 'OTHER' and asset.asset_class_code in ('PPE','INTANGIBLE'))) then
    valuation_mode := case when asset.asset_type in ('GOLD','SILVER') and asset.metadata->>'market_value_auto' = 'true' then 'AUTOMATIC' else 'MANUAL' end;
  end if;

  if can_write then
    -- Only the first opening or purchase can be the registration transaction.
    -- A backdated subsequent movement still locks registration.
    select id into initial_id from public.transactions
      where asset_account_id = asset.id and transaction_type in ('OPENING_BALANCE','PURCHASE')
      order by (metadata->>'source' = 'ATOMIC_ASSET_ACQUISITION') desc nulls last, created_at, id
      limit 1;
    select * into movement from public.transactions
      where asset_account_id = asset.id and id is distinct from initial_id
      order by created_at, id limit 1;
    if found then
      reason := jsonb_build_object('code','MOVEMENT','id',movement.id,'date',movement.transaction_date,
        'reference',coalesce(movement.metadata->>'document_sequence',movement.reference),
        'operation',coalesce(movement.metadata->>'operation',movement.transaction_type::text));
    else
      select c.financial_event_id, c.operation, c.operation_date into linked_operation
      from public.asset_lifecycle_commands c
      where c.asset_account_id = asset.id and c.financial_event_id is not null
      order by c.created_at, c.id limit 1;
      if found then
        reason := jsonb_build_object('code','LIFECYCLE','id',linked_operation.financial_event_id,
          'operation',linked_operation.operation,'date',linked_operation.operation_date);
      end if;
    end if;

    if reason is null and asset.ownership_scope = 'PERSONAL' then
      select a.id, a.assessment_date into assessment_id, assessment_date
      from public.zakat_assessment_lines line
      join public.zakat_assessments a on a.id = line.assessment_id and a.status <> 'CANCELLED'
      left join public.lots lot on lot.id = line.lot_id
      where a.user_id = actor and (lot.asset_account_id = asset.id or line.valuation_snapshot->>'assetId' = asset.id::text)
      order by a.created_at, a.id limit 1;
    elsif reason is null and asset.ownership_scope = 'ORGANIZATION' then
      select s.id, s.assessment_date into assessment_id, assessment_date
      from public.corporate_zakat_sources s
      where s.organization_id = asset.organization_id and s.entries @> jsonb_build_array(
        jsonb_build_object('id',asset.id,'source','ASSET_BOOK_OR_SAVED_VALUE'))
      order by s.created_at, s.id limit 1;
    end if;
    if reason is null and assessment_id is not null then
      reason := jsonb_build_object('code','ZAKAT','date',assessment_date);
    end if;
  else
    reason := jsonb_build_object('code','ACCESS');
  end if;

  if asset.ownership_scope = 'ORGANIZATION' and asset.asset_class_code in ('PPE','INTANGIBLE') then
    book := private.financial_opening_asset_book(asset.organization_id,asset.id,
      (statement_timestamp() at time zone 'Asia/Riyadh')::date);
    if book->>'known' = 'true' and book->>'issue' is null then
      book := book || jsonb_build_object('net', (book->>'gross')::numeric - (book->>'depreciation')::numeric);
    else
      book := null;
    end if;
  end if;

  return jsonb_build_object('asset_registration_can_edit', can_write and reason is null,
    'asset_market_valuation_can_update', valuation_mode is not null,
    'valuation_mode', valuation_mode, 'registration_lock', reason, 'book', book);
end;
$$;
revoke all on function public.asset_edit_availability(uuid) from public, anon;
grant execute on function public.asset_edit_availability(uuid) to authenticated;

create function public.guard_asset_registration_fields()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare policy jsonb;
begin
  -- Internal backfills have no signed-in actor. Application writes use the same
  -- registration policy as the asset card, including direct authenticated writes.
  if auth.uid() is null or old.metadata ?| array['investment_id','register_source','financing_contract_id','personal_contract_id']
     or old.metadata->>'acquisition_mode' = 'INVESTMENT' then return new; end if;
  if old.name is not distinct from new.name and not exists(
    select 1 from unnest(array['quantity','purchase_value','opening_value','purchase_price','purchase_date',
      'karat','purity','acquisition_mode','holding_purpose','purpose','funding_account_id','fx_rate',
      'tax_category','vat_rate','vat_amount','recoverable_percent','tax_exemption_reason_code','tax_exemption_reason',
      'counterparty_id','invoice_reference','due_date']) key
    where old.metadata->key is distinct from new.metadata->key
  ) then return new; end if;
  policy := public.asset_edit_availability(old.id);
  if policy->>'asset_registration_can_edit' is distinct from 'true' then
    raise exception 'ASSET_REGISTRATION_LOCKED' using detail = (policy->'registration_lock')::text;
  end if;
  return new;
end;
$$;
create trigger trg_asset_registration_fields before update of name, metadata on public.asset_accounts
for each row execute function public.guard_asset_registration_fields();
revoke all on function public.guard_asset_registration_fields() from public, anon, authenticated;

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
  policy jsonb;
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  if (p_name is null) = (p_market_price is null) then raise exception 'ASSET_EDIT_INPUT_INVALID'; end if;
  if p_name is not null and (trimmed_name !~ '[^[:space:]]' or length(trimmed_name) > 120) then
    raise exception 'ASSET_EDIT_NAME_INVALID';
  end if;

  if p_name is not null then
    perform pg_advisory_xact_lock(hashtextextended('zakat-snapshot:' || actor::text, 0));
  end if;
  select * into previous from public.asset_accounts where id = p_asset_id;
  if not found then raise exception 'ASSET_NOT_FOUND'; end if;
  if previous.ownership_scope = 'ORGANIZATION'
    and public.has_organization_permission(previous.organization_id, 'assets.edit') is not true then
    raise exception 'ASSET_EDIT_ACCESS_DENIED';
  end if;
  select * into previous from public.asset_accounts where id = p_asset_id for update;
  if not found then raise exception 'ASSET_EDIT_ACCESS_DENIED'; end if;
  if previous.updated_at is distinct from p_expected_updated_at then
    raise exception 'ASSET_EDIT_CONFLICT';
  end if;

  policy := public.asset_edit_availability(previous.id);
  if p_name is not null and policy->>'asset_registration_can_edit' is distinct from 'true' then
    raise exception 'ASSET_REGISTRATION_LOCKED' using detail = (policy->'registration_lock')::text;
  end if;
  trimmed_name := coalesce(trimmed_name, previous.name);
  next_metadata := previous.metadata;
  if p_market_price is not null then
    if policy->>'valuation_mode' = 'AUTOMATIC' then raise exception 'ASSET_AUTOMATIC_VALUATION_REQUIRED'; end if;
    if policy->>'valuation_mode' is distinct from 'MANUAL' then
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
  values (actor, 'asset_account', previous.id,
    case when p_name is null then 'UPDATE_ASSET_MARKET_VALUATION' else 'UPDATE_ASSET_DETAILS' end,
    to_jsonb(previous), to_jsonb(saved));
  return saved;
end;
$$;
revoke all on function public.edit_asset_details(uuid, timestamptz, text, numeric) from public, anon;
grant execute on function public.edit_asset_details(uuid, timestamptz, text, numeric) to authenticated;
