-- Run against a disposable database with two synthetic auth.users.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
insert into public.profiles(id) select id from auth.users where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002') on conflict do nothing;
insert into public.personal_income_issuers(owner_id,vat_number,address,valid_from,valid_until)
values ('00000000-0000-4000-8000-000000000001','300000000000003','Riyadh QA address','2025-01-01','2099-12-31');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
insert into public.personal_income_profiles(seller_name,vat_number,effective_from)
values ('Test professional','300000000000003','2026-01-01');
do $$
declare
  request_id uuid := gen_random_uuid();
  invoice public.personal_income_documents;
  retry public.personal_income_documents;
  bank uuid;
  receipt jsonb;
  payload jsonb;
  period jsonb;
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
  assert invoice.kind='EXTERNAL_EVIDENCE' and invoice.receivable_id is not null;
  insert into public.personal_income_evidence values(invoice.id,gen_random_uuid(),'proof','proof.pdf','JVBERi0xLjQ=');
  insert into public.asset_accounts(user_id,asset_type,name,currency,ownership_scope) values(auth.uid(),'BANK','Test bank','SAR','PERSONAL') returning id into bank;
  payload:=jsonb_build_object('action','COLLECT','source_id',invoice.receivable_id,'destination_id',bank,'request_id',gen_random_uuid(),'date','2026-01-02','amount',4000,'notes','Partial settlement');
  receipt:=public.transfer_personal_financial_account(payload);
  assert public.transfer_personal_financial_account(payload)=receipt;
  assert (select sum(remaining_value_base)=7500 from public.lots where asset_account_id=invoice.receivable_id);
  assert (select sum(remaining_value_base)=4000 from public.lots where asset_account_id=bank);
  period:=public.personal_income_period('2026-01-01','2026-01-31');
  assert (period->>'net')::numeric=10000 and (period->>'tax')::numeric=1500 and (period->>'count')::int=1;
  assert (select count(*)=1 from public.personal_income_evidence);
  request_id:=gen_random_uuid();
  invoice:=public.record_personal_income_document(request_id,'SIMPLIFIED','2026-01-02','Consumer','Service',null,10000,1500);
  assert invoice.kind='SIMPLIFIED_INVOICE' and invoice.invoice_number=1 and invoice.issued_at is not null and invoice.receivable_id is not null;
  retry:=public.record_personal_income_document(request_id,'SIMPLIFIED','2026-01-02','Consumer','Service',null,10000,1500);
  assert retry.id=invoice.id and retry.receivable_id=invoice.receivable_id;
  assert (public.personal_income_period('2026-01-02','2026-01-02')->>'net')::numeric=10000;
  payload:=payload||jsonb_build_object('source_id',invoice.receivable_id,'request_id',gen_random_uuid());
  perform public.transfer_personal_financial_account(payload);
  assert (select sum(remaining_value_base)=7500 from public.lots where asset_account_id=invoice.receivable_id);
  assert (public.personal_income_period('2026-01-02','2026-01-02')->>'net')::numeric=10000;
  assert (public.personal_income_period('2026-02-01','2026-02-28')->>'count')::int=0;
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
  assert (select count(*)=0 from public.personal_income_evidence);
  assert not has_table_privilege(current_user,'public.personal_income_documents','INSERT');
end;
$$;
insert into public.personal_income_profiles(seller_name) values ('Other professional');
do $$
declare invoice public.personal_income_documents;
begin
  invoice := public.record_personal_income_document(gen_random_uuid(),'INVOICE','2026-01-01','Client','Consultation',null,10000,0);
  assert invoice.serial=1 and invoice.kind='FEE_INVOICE';
  begin
    perform public.record_personal_income_document(gen_random_uuid(),'SIMPLIFIED','2026-01-02','Consumer','Service',null,10000,1500);
    assert false;
  exception when raise_exception then assert sqlerrm='SIMPLIFIED_ISSUER_UNAVAILABLE'; end;
end;
$$;
rollback;
