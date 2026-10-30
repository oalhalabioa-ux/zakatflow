-- Phase 1 invoice issuance: atomically lock the draft, construct ZATCA's five
-- mandatory QR fields as UTF-8 TLV, and persist the final issued state.
create or replace function public.issue_vat_einvoice(p_invoice_id uuid)
returns public.vat_einvoices
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice public.vat_einvoices;
  v_payload bytea := ''::bytea;
  v_values text[];
  v_value_bytes bytea;
  v_timestamp text;
  v_index integer;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select * into v_invoice
  from public.vat_einvoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'EINVOICE_NOT_FOUND';
  end if;
  if not exists (
    select 1 from public.organization_members
    where organization_id = v_invoice.organization_id
      and user_id = v_user_id
      and status = 'ACTIVE'
      and role in ('OWNER', 'ADMIN')
  ) then
    raise exception 'ORGANIZATION_ADMIN_REQUIRED';
  end if;
  if v_invoice.status <> 'DRAFT' then
    raise exception 'EINVOICE_NOT_DRAFT';
  end if;
  if v_invoice.document_type <> 'INVOICE' then
    raise exception 'NOTE_ISSUANCE_NOT_SUPPORTED';
  end if;

  v_timestamp := to_char(v_invoice.issue_date, 'YYYY-MM-DD') || 'T' ||
    to_char(v_invoice.issue_time, 'HH24:MI:SS') || '+03:00';
  v_values := array[
    v_invoice.seller_name,
    v_invoice.seller_vat_number,
    v_timestamp,
    to_char(v_invoice.tax_inclusive_amount, 'FM99999999999999999990.00'),
    to_char(v_invoice.tax_total_amount, 'FM99999999999999999990.00')
  ];

  for v_index in 1..array_length(v_values, 1) loop
    v_value_bytes := convert_to(v_values[v_index], 'UTF8');
    if octet_length(v_value_bytes) > 255 then
      raise exception 'QR_FIELD_TOO_LONG';
    end if;
    v_payload := v_payload
      || decode(lpad(to_hex(v_index), 2, '0'), 'hex')
      || decode(lpad(to_hex(octet_length(v_value_bytes)), 2, '0'), 'hex')
      || v_value_bytes;
  end loop;

  if length(translate(encode(v_payload, 'base64'), E'\n\r', '')) > 700 then
    raise exception 'QR_PAYLOAD_TOO_LONG';
  end if;

  update public.vat_einvoices
  set status = 'ISSUED',
      qr_code = translate(encode(v_payload, 'base64'), E'\n\r', ''),
      issued_at = now(),
      updated_at = now()
  where id = p_invoice_id
  returning * into v_invoice;

  return v_invoice;
end;
$$;

revoke all on function public.issue_vat_einvoice(uuid) from public, anon;
grant execute on function public.issue_vat_einvoice(uuid) to authenticated;
