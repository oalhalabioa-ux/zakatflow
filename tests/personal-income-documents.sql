-- Run against a disposable database with two synthetic auth.users.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
insert into public.personal_income_profiles(seller_name,vat_number,effective_from)
values ('Test professional','300000000000003','2026-01-01');
do $$
declare
  request_id uuid := gen_random_uuid();
  invoice public.personal_income_documents;
  retry public.personal_income_documents;
begin
  invoice := public.record_personal_income_document(request_id,'INVOICE','2026-01-01','Client','Consultation',null,10000,1500);
  assert invoice.kind='TAX_DRAFT' and invoice.gross_amount=11500 and invoice.serial=1;
  retry := public.record_personal_income_document(request_id,'INVOICE','2026-01-01','Client','Consultation',null,10000,1500);
  assert retry.id=invoice.id;
  invoice := public.record_personal_income_document(gen_random_uuid(),'INVOICE','2025-12-31','Client','Consultation',null,10000,0);
  assert invoice.kind='FEE_INVOICE' and invoice.seller_vat_number is null;
  begin
    perform public.record_personal_income_document(gen_random_uuid(),'INVOICE','2025-12-31','Client','Consultation',null,10000,1500);
    assert false;
  exception when raise_exception then assert sqlerrm='VAT_REGISTRATION_REQUIRED'; end;
  invoice := public.record_personal_income_document(gen_random_uuid(),'EVIDENCE','2026-01-01','Client','Consultation','REF1',10000,1500);
  assert invoice.kind='EXTERNAL_EVIDENCE';
  begin
    perform public.record_personal_income_document(gen_random_uuid(),'EVIDENCE','2026-01-01','client','Consultation','ref1',10000,1500);
    assert false;
  exception when unique_violation then null; end;
end;
$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
do $$
begin
  assert (select count(*)=0 from public.personal_income_documents);
  assert (select count(*)=0 from public.personal_income_profiles);
  assert not has_table_privilege(current_user,'public.personal_income_documents','INSERT');
end;
$$;
insert into public.personal_income_profiles(seller_name) values ('Other professional');
do $$
declare invoice public.personal_income_documents;
begin
  invoice := public.record_personal_income_document(gen_random_uuid(),'INVOICE','2026-01-01','Client','Consultation',null,10000,0);
  assert invoice.serial=1 and invoice.kind='FEE_INVOICE';
end;
$$;
rollback;
