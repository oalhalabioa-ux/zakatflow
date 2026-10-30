create table public.vat_invoice_number_sequences (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  prefix text not null,
  digit_width integer not null check (digit_width between 1 and 30),
  next_value numeric(31,0) not null check (next_value > 0),
  updated_at timestamptz not null default now()
);
alter table public.vat_invoice_number_sequences enable row level security;
revoke all on public.vat_invoice_number_sequences from anon;
grant select,insert,update on public.vat_invoice_number_sequences to authenticated;
create policy invoice_sequence_admin on public.vat_invoice_number_sequences for all to authenticated
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

create function public.reserve_vat_invoice_number(p_organization_id uuid, p_first_number text default null)
returns text language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  s public.vat_invoice_number_sequences%rowtype;
  parts text[];
  candidate text;
  initialized boolean;
begin
  if auth.uid() is null or not public.is_organization_admin(p_organization_id) then
    raise exception 'ORGANIZATION_ADMIN_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('vat-invoice-number:' || p_organization_id::text, 0));
  select * into s from public.vat_invoice_number_sequences where organization_id=p_organization_id for update;
  initialized := found;
  if not initialized then
    parts := regexp_match(trim(coalesce(p_first_number,'')), '^(.*[^0-9])?([0-9]{1,30})$');
    if parts is null or length(trim(p_first_number))>100 or parts[2]::numeric<=0 then
      raise exception 'INVOICE_SEQUENCE_START_INVALID';
    end if;
    s.organization_id:=p_organization_id; s.prefix:=coalesce(parts[1],'');
    s.digit_width:=length(parts[2]); s.next_value:=parts[2]::numeric;
  end if;
  for attempt in 1..1000 loop
    if length(s.next_value::text)>30 then raise exception 'INVOICE_SEQUENCE_EXHAUSTED'; end if;
    candidate:=s.prefix || lpad(s.next_value::text,greatest(s.digit_width,length(s.next_value::text)),'0');
    if length(candidate)>100 then raise exception 'INVOICE_SEQUENCE_EXHAUSTED'; end if;
    if not exists(select 1 from public.vat_einvoices where organization_id=p_organization_id and invoice_number=candidate)
      and not exists(select 1 from public.vat_documents where organization_id=p_organization_id and document_type='SALES' and document_kind='INVOICE' and document_number=candidate) then
      insert into public.vat_invoice_number_sequences(organization_id,prefix,digit_width,next_value)
      values(p_organization_id,s.prefix,s.digit_width,s.next_value+1)
      on conflict(organization_id) do update set next_value=excluded.next_value,updated_at=now();
      return candidate;
    end if;
    if not initialized then raise exception 'INVOICE_SEQUENCE_START_EXISTS'; end if;
    s.next_value:=s.next_value+1;
  end loop;
  raise exception 'INVOICE_SEQUENCE_EXHAUSTED';
end $$;
revoke all on function public.reserve_vat_invoice_number(uuid,text) from public,anon;
grant execute on function public.reserve_vat_invoice_number(uuid,text) to authenticated;

create function public.peek_vat_invoice_number(p_organization_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.vat_invoice_number_sequences%rowtype;
begin
 if auth.uid() is null or not public.is_organization_admin(p_organization_id) then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
 select * into s from public.vat_invoice_number_sequences where organization_id=p_organization_id;
 if not found then return jsonb_build_object('initialized',false,'next_number',null); end if;
 return jsonb_build_object('initialized',true,'next_number',s.prefix || lpad(s.next_value::text,greatest(s.digit_width,length(s.next_value::text)),'0'));
end $$;
revoke all on function public.peek_vat_invoice_number(uuid) from public,anon;
grant execute on function public.peek_vat_invoice_number(uuid) to authenticated;
