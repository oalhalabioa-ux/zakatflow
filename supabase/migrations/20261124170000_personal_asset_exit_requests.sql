-- Keep the replay record in the same transaction as the existing posting and audit.
create table private.personal_asset_exit_requests (
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  fingerprint bytea not null,
  result jsonb not null,
  primary key (owner_id, request_id)
);

alter table private.personal_asset_exit_requests enable row level security;
revoke all on private.personal_asset_exit_requests from public, anon, authenticated;
grant select, insert on private.personal_asset_exit_requests to authenticated;

create policy personal_asset_exit_request_read on private.personal_asset_exit_requests
  for select to authenticated using (owner_id = (select auth.uid()));
create policy personal_asset_exit_request_write on private.personal_asset_exit_requests
  for insert to authenticated with check (owner_id = (select auth.uid()));

-- SECURITY INVOKER preserves the permissions and guards of the current posting RPCs.
create function public.post_personal_asset_exit(
  p_request_id uuid, p_kind text, p_asset_id uuid, p_destination_id uuid, p_date date,
  p_quantity numeric, p_sale_value numeric, p_currency text, p_base_currency text,
  p_base_value numeric, p_notes text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  owner uuid := auth.uid();
  payload_hash bytea;
  prior private.personal_asset_exit_requests%rowtype;
  posting jsonb;
  transaction_id uuid;
  audit_data jsonb;
begin
  if owner is null then raise exception 'UNAUTHORIZED'; end if;
  if p_request_id is null or p_kind is null or p_kind not in ('SALE', 'DISPOSAL')
    or p_asset_id is null or p_date is null or p_quantity is null or p_quantity <= 0
    or p_quantity::text in ('NaN', 'Infinity') then
    raise exception 'PERSONAL_ASSET_EXIT_INVALID';
  end if;
  if p_kind = 'SALE' and (
    p_destination_id is null or p_sale_value is null or p_sale_value <= 0 or
    p_base_value is null or p_base_value <= 0 or p_currency is null or p_base_currency is null
    or p_sale_value::text in ('NaN', 'Infinity') or p_base_value::text in ('NaN', 'Infinity')
  ) then
    raise exception 'INVALID_SALE';
  end if;

  payload_hash := pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(
    p_kind, p_asset_id, p_date, pg_catalog.trim_scale(p_quantity), p_notes,
    case when p_kind = 'SALE' then pg_catalog.jsonb_build_array(
      p_destination_id, pg_catalog.trim_scale(p_sale_value), p_currency,
      p_base_currency, pg_catalog.trim_scale(p_base_value)
    ) end
  )::text, 'UTF8'));

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('personal-asset-exit:' || owner::text || ':' || p_request_id::text, 0)
  );
  select * into prior from private.personal_asset_exit_requests
    where owner_id = owner and request_id = p_request_id;
  if found then
    if prior.fingerprint is distinct from payload_hash then
      raise exception 'PERSONAL_ASSET_EXIT_REQUEST_CONFLICT';
    end if;
    return prior.result;
  end if;

  if p_kind = 'SALE' then
    posting := public.post_sale_with_proceeds(owner, p_asset_id, p_destination_id, p_date,
      p_quantity, p_sale_value, p_currency, p_base_currency, p_base_value, p_notes);
    transaction_id := (posting->>'sale_transaction_id')::uuid;
    audit_data := pg_catalog.jsonb_build_object(
      'asset_account_id', p_asset_id, 'transaction_type', 'SALE', 'transaction_date', p_date,
      'quantity', p_quantity, 'gross_value', p_sale_value, 'base_value', p_base_value,
      'currency', p_currency, 'base_currency', p_base_currency, 'notes', p_notes,
      'metadata', pg_catalog.jsonb_build_object('fx_rate', p_base_value / p_sale_value),
      'proceeds_account_id', p_destination_id, 'sale_result', posting
    );
  else
    transaction_id := public.post_asset_disposal(owner, p_asset_id, p_date, p_quantity, p_notes);
    posting := pg_catalog.to_jsonb(transaction_id);
    audit_data := pg_catalog.jsonb_build_object(
      'asset_account_id', p_asset_id, 'quantity', p_quantity, 'reason', 'DISPOSAL_ZERO_VALUE'
    );
  end if;

  insert into public.audit_logs (user_id, entity_type, entity_id, action, new_data)
    values (owner, 'transaction', transaction_id, 'CREATE', audit_data);
  insert into private.personal_asset_exit_requests (owner_id, request_id, fingerprint, result)
    values (owner, p_request_id, payload_hash, posting);
  return posting;
end;
$$;

revoke all on function public.post_personal_asset_exit(uuid, text, uuid, uuid, date, numeric, numeric, text, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.post_personal_asset_exit(uuid, text, uuid, uuid, date, numeric, numeric, text, text, numeric, text)
  to authenticated;
