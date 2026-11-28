-- Run only on a disposable database after both source migrations and the cutoff migration.
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('b3700000-0000-4000-8000-000000000001','document-owner@example.invalid',now()),
 ('b3700000-0000-4000-8000-000000000002','other-owner@example.invalid',now());
insert into public.profiles(id,base_currency) values
 ('b3700000-0000-4000-8000-000000000001','SAR'),
 ('b3700000-0000-4000-8000-000000000002','SAR')
 on conflict(id) do update set base_currency=excluded.base_currency;
insert into public.personal_income_issuers(owner_id,vat_number,address,valid_from,valid_until)
 values ('b3700000-0000-4000-8000-000000000001','300000000000003','Synthetic address','2025-01-01','2099-12-31');
insert into public.asset_accounts(id,user_id,asset_type,name,currency,ownership_scope)
 values ('b3700000-0000-4000-8000-000000000003','b3700000-0000-4000-8000-000000000001','BANK','Receivable fixture bank','SAR','PERSONAL');

create function pg_temp.read_debt(p_id uuid,p_cutoff date) returns jsonb
language sql stable as $$
 select r from jsonb_array_elements(public.read_personal_debts_at_cutoff(p_cutoff)->'rows') r where r->>'id'=p_id::text
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','b3700000-0000-4000-8000-000000000001',true);
insert into public.personal_income_profiles(seller_name,vat_number,effective_from)
 values ('Synthetic practice','300000000000003','2026-01-01');
do $$
declare
 request uuid:=gen_random_uuid();
 invoice public.personal_income_documents;
 draft public.personal_income_documents;
 bank uuid:='b3700000-0000-4000-8000-000000000003';
 opening_id uuid;
 receipt jsonb;
 payload jsonb;
 row_before jsonb;
 row_after jsonb;
 period_income jsonb;
begin
 invoice:=public.record_personal_income_document(request,'SIMPLIFIED','2026-01-02','Synthetic client','Synthetic service',null,10000,1500);
 assert invoice.kind='SIMPLIFIED_INVOICE';
 assert public.record_personal_income_document(request,'SIMPLIFIED','2026-01-02','Synthetic client','Synthetic service',null,10000,1500)=invoice;
 draft:=public.record_personal_income_document(gen_random_uuid(),'INVOICE','2026-01-02','Draft client','Synthetic draft',null,10000,1500);
 assert draft.kind='TAX_DRAFT' and draft.receivable_id is null;
 insert into public.personal_income_evidence values(invoice.id,gen_random_uuid(),'test-proof','proof.pdf','JVBERi0xLjQ=');

 assert pg_temp.read_debt(invoice.receivable_id,'2026-01-01') is null;
 row_before:=pg_temp.read_debt(invoice.receivable_id,'2026-01-02');
 assert row_before->>'balance' is not null and (row_before->>'balance')::numeric=11500 and row_before->>'gap' is null,
   format('Expected document-origin receivable of 11500, got %s',row_before);
 payload:=jsonb_build_object('action','COLLECT','source_id',invoice.receivable_id,'destination_id',bank,
   'request_id',gen_random_uuid(),'date','2026-01-03','amount',4000,'notes','Synthetic partial settlement');
 receipt:=public.transfer_personal_financial_account(payload);
 assert public.transfer_personal_financial_account(payload)=receipt;
 assert pg_temp.read_debt(invoice.receivable_id,'2026-01-02')=row_before;
 row_after:=pg_temp.read_debt(invoice.receivable_id,'2026-01-03');
 assert row_after->>'balance' is not null and (row_after->>'balance')::numeric=7500 and row_after->>'gap' is null,
   format('Expected receivable of 7500 after the collection, got %s',row_after);
 assert (select sum(remaining_value_base) from public.lots where asset_account_id=invoice.receivable_id)=7500;
 assert (select sum(remaining_value_base) from public.lots where asset_account_id=bank)=4000;
 assert (select count(*) from public.transactions where transfer_id=(receipt->>'transfer_id')::uuid)=2;
 period_income:=public.personal_income_period('2026-01-02','2026-01-31');
 assert (period_income->>'net')::numeric=10000 and (period_income->>'tax')::numeric=1500 and (period_income->>'count')::int=1;
 assert (public.personal_income_period('2026-01-03','2026-01-03')->>'count')::int=0;
 assert not exists(select 1 from public.read_personal_income_expense('2026-01-02','2026-01-31'));

 opening_id:=(public.create_asset_with_acquisition('{"name":"Legacy opening receivable","asset_type":"RECEIVABLE","currency":"SAR","metadata":{"quantity":80,"purchase_value":80,"purchase_date":"2026-01-01","acquisition_mode":"OPENING_BALANCE"}}',gen_random_uuid())->>'id')::uuid;
 assert pg_temp.read_debt(opening_id,'2026-01-03')->>'balance' is not null and
   (pg_temp.read_debt(opening_id,'2026-01-03')->>'balance')::numeric=80;

 perform set_config('receivable.qa.in_tx',receipt->>'in_transaction_id',true);
 perform set_config('receivable.qa.origin',invoice.receivable_id::text,true);
end
$$;

-- Simulate imported or incomplete evidence without using a production write path.
reset role;
update public.transactions set metadata=metadata||'{"asset_deleted":"true"}'::jsonb
 where id=current_setting('receivable.qa.in_tx')::uuid;
set local role authenticated;
do $$
declare origin uuid:=current_setting('receivable.qa.origin')::uuid; debt jsonb;
begin
 assert (pg_temp.read_debt(origin,'2026-01-02')->>'balance')::numeric=11500;
 debt:=pg_temp.read_debt(origin,'2026-01-03');
 assert debt->>'gap'='RECEIVABLE_SOURCE_UNVERIFIED' and debt->>'balance' is null;
 perform set_config('request.jwt.claim.sub','b3700000-0000-4000-8000-000000000002',true);
 assert pg_temp.read_debt(origin,'2026-01-03') is null;
 assert (public.personal_income_period('2026-01-02','2026-01-31')->>'count')::int=0;
 raise notice 'PASS document receivable 11500 before collection / 7500 after, cash 4000, net 10000 once, verified cutoff and isolation';
end
$$;
rollback;
