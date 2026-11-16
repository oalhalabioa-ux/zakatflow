create or replace function public.guard_vat_invoice_issue_registration()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.status = 'DRAFT' and new.status = 'ISSUED' then
    if not exists (
      select 1
      from public.vat_profiles profile
      where profile.organization_id = new.organization_id
        and profile.registration_status = 'REGISTERED'
        and btrim(profile.tax_registration_number) = new.seller_vat_number
    ) then
      raise exception 'VAT_REGISTRATION_REQUIRED';
    end if;
    if nullif(btrim(new.qr_code), '') is null then
      raise exception 'ISSUED_INVOICE_QR_REQUIRED';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_vat_invoice_issue_registration() from public, anon, authenticated;

drop trigger if exists guard_vat_invoice_issue_registration on public.vat_einvoices;
create trigger guard_vat_invoice_issue_registration
before update of status on public.vat_einvoices
for each row execute function public.guard_vat_invoice_issue_registration();
