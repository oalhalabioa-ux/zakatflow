-- Run inside BEGIN/ROLLBACK after setting test.organization_id and JWT claims
-- for an active organization admin. Requires an unconfigured test sequence.
set local role authenticated;
do $$
declare
  org uuid := current_setting('test.organization_id')::uuid;
  existing text;
  n text;
begin
  if (public.peek_vat_invoice_number(org)->>'initialized')::boolean then
    raise exception 'Test requires an unconfigured sequence';
  end if;
  begin
    perform public.reserve_vat_invoice_number(org, 'INVALID');
    raise exception 'Invalid seed accepted';
  exception when others then
    if sqlerrm <> 'INVOICE_SEQUENCE_START_INVALID' then raise; end if;
  end;
  select document_number into existing from public.vat_documents
    where organization_id=org and document_type='SALES' and document_kind='INVOICE'
      and document_number ~ '^[1-9][0-9]{0,29}$' limit 1;
  if existing is not null then
    begin
      perform public.reserve_vat_invoice_number(org, existing);
      raise exception 'Existing invoice number accepted';
    exception when others then
      if sqlerrm <> 'INVOICE_SEQUENCE_START_EXISTS' then raise; end if;
    end;
    if (public.peek_vat_invoice_number(org)->>'initialized')::boolean then
      raise exception 'Rejected seed changed sequence';
    end if;
  end if;
  n := public.reserve_vat_invoice_number(org, 'QA-0009');
  if n <> 'QA-0009' then raise exception 'Wrong initial number: %',n; end if;
  n := public.reserve_vat_invoice_number(org, 'IGNORED-5000');
  if n <> 'QA-0010' then raise exception 'Sequence reset unexpectedly: %',n; end if;
  if public.peek_vat_invoice_number(org)->>'next_number' <> 'QA-0011' then
    raise exception 'Incorrect preview';
  end if;
  update public.vat_invoice_number_sequences set next_value=999,digit_width=3 where organization_id=org;
  if public.reserve_vat_invoice_number(org) <> 'QA-999'
    or public.reserve_vat_invoice_number(org) <> 'QA-1000' then
    raise exception 'Digit rollover failed';
  end if;
  update public.vat_invoice_number_sequences set next_value=123456789012345678901234567890,digit_width=30 where organization_id=org;
  if public.reserve_vat_invoice_number(org) <> 'QA-123456789012345678901234567890'
    or public.peek_vat_invoice_number(org)->>'next_number' <> 'QA-123456789012345678901234567891' then
    raise exception 'Numeric precision lost';
  end if;
  if existing is not null then
    update public.vat_invoice_number_sequences set prefix='',digit_width=length(existing),next_value=existing::numeric where organization_id=org;
    n := public.reserve_vat_invoice_number(org);
    if n=existing then raise exception 'Existing number reused'; end if;
  end if;
  update public.vat_invoice_number_sequences set next_value=1000000000000000000000000000000 where organization_id=org;
  begin
    perform public.reserve_vat_invoice_number(org);
    raise exception 'Exhausted sequence accepted';
  exception when others then
    if sqlerrm <> 'INVOICE_SEQUENCE_EXHAUSTED' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
  if exists(select 1 from public.vat_invoice_number_sequences where organization_id=org) then
    raise exception 'Nonmember can read counter';
  end if;
  begin
    perform public.reserve_vat_invoice_number(org,'QA-100');
    raise exception 'Nonmember reservation allowed';
  exception when others then
    if sqlerrm <> 'ORGANIZATION_ADMIN_REQUIRED' then raise; end if;
  end;
end $$;
reset role;
select 'numbering assertions passed' as result;
