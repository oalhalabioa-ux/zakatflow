-- Run against seeded QA only. All fixtures and counter changes are rolled back.
begin;
do $$
declare
  org uuid; other_org uuid; a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid();
  t public.transactions%rowtype; d public.vat_documents%rowtype;
  n1 text; n2 text; alias_number text; invoice_id uuid; tx_id uuid;
begin
  select * into t from public.transactions where organization_id is not null
    and transaction_type='PURCHASE' and reversal_of_transaction_id is null limit 1;
  org:=t.organization_id;
  perform set_config('request.jwt.claim.sub',(select user_id::text from public.organization_members
    where organization_id=org and status='ACTIVE' and role in ('OWNER','ADMIN') limit 1),true);
  select id into other_org from public.organizations where id<>org limit 1;
  if org is null or other_org is null then raise exception 'SEEDED_QA_REQUIRED'; end if;
  n1:=private.allocate_purchase_invoice_number(org,'ASSET',a,'2099-01-01');
  n2:=private.allocate_purchase_invoice_number(org,'VAT',b,'2099-01-01');
  assert n1='PUR-2099-000001' and n2='PUR-2099-000002', 'mixed sources must share a counter';
  assert private.allocate_purchase_invoice_number(org,'ASSET',a,'2100-01-01')=n1, 'identity retry must keep its number even after date changes';
  assert private.allocate_purchase_invoice_number(other_org,'VAT',gen_random_uuid(),'2099-01-01')='PUR-2099-000001', 'company isolation';
  assert private.allocate_purchase_invoice_number(org,'VAT',gen_random_uuid(),'2100-01-01')='PUR-2100-000001', 'year isolation';
  assert not has_function_privilege('authenticated','private.allocate_purchase_invoice_number(uuid,text,uuid,date)','EXECUTE'), 'allocator is private';
  assert not has_table_privilege('authenticated','private.purchase_invoice_numbers','INSERT'), 'clients cannot allocate or overwrite numbers';
  assert not has_table_privilege('anon','private.purchase_invoice_counters','SELECT'), 'anonymous counter access denied';

  select * into d from public.vat_documents where organization_id=org and document_type='PURCHASE' and document_kind='INVOICE' limit 1;
  if d.id is null then raise exception 'SEEDED_QA_PURCHASE_INVOICE_REQUIRED'; end if;
  tx_id:=gen_random_uuid();
  t.id:=tx_id; t.transaction_date:='2099-01-02'; t.reference:='QA-NUMBER-ASSET';
  t.metadata:='{}'; t.purchase_number:='FORGED';
  insert into public.transactions select t.* returning purchase_number into n1;
  assert n1='PUR-2099-000003', 'asset trigger must replace forged number';
  invoice_id:=gen_random_uuid(); d.id:=invoice_id; d.asset_transaction_id:=tx_id;
  d.transaction_date:='2099-01-02'; d.due_date:='2099-01-02';
  d.document_number:='QA-NUMBER-ALIAS'; d.purchase_number:='FORGED';
  insert into public.vat_documents select d.* returning purchase_number into alias_number;
  assert alias_number=n1, 'VAT alias must reuse asset allocation';
  assert (select last_value from private.purchase_invoice_counters where organization_id=org and invoice_year=2099)=3, 'alias must not consume another number';
  update public.transactions set reference='QA-NUMBER-EDIT',transaction_date='2100-01-02' where id=tx_id returning purchase_number into n2;
  assert n2=n1, 'supplier/date editing must preserve the allocated number';
  begin
    update public.transactions set purchase_number='FORGED-UPDATE' where id=tx_id;
    raise exception 'IMMUTABLE_GUARD_MISSING';
  exception when raise_exception then if sqlerrm<>'PURCHASE_NUMBER_IMMUTABLE' then raise; end if; end;
  begin
    update public.vat_documents set purchase_number='FORGED-UPDATE' where id=invoice_id;
    raise exception 'IMMUTABLE_GUARD_MISSING';
  exception when raise_exception then if sqlerrm<>'PURCHASE_NUMBER_IMMUTABLE' then raise; end if; end;
  delete from public.vat_documents where id=invoice_id;
  delete from public.transactions where id=tx_id;
  assert private.allocate_purchase_invoice_number(org,'ASSET',tx_id,'2099-01-02')=n1, 'deleted source allocation is retained';
  assert private.allocate_purchase_invoice_number(org,'VAT',gen_random_uuid(),'2099-01-02')='PUR-2099-000004', 'deletion never recycles numbers';
end $$;
rollback;
