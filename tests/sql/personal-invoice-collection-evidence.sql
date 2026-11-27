begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('b4630400-0000-4000-8000-000000000001','hawl-receipts-owner@example.invalid',now()),
 ('b4630400-0000-4000-8000-000000000002','hawl-receipts-other@example.invalid',now());
insert into public.profiles(id,base_currency) values
 ('b4630400-0000-4000-8000-000000000001','SAR'),('b4630400-0000-4000-8000-000000000002','SAR')
 on conflict(id) do update set base_currency=excluded.base_currency;
insert into public.personal_income_issuers(owner_id,vat_number,address,valid_from,valid_until) values
 ('b4630400-0000-4000-8000-000000000001','300000000000003','Synthetic address','2025-01-01','2099-12-31');
insert into public.asset_accounts(id,user_id,asset_type,name,currency,ownership_scope) values
 ('b4630400-0000-4000-8000-000000000003','b4630400-0000-4000-8000-000000000001','BANK','Collection bank','SAR','PERSONAL'),
 ('b4630400-0000-4000-8000-000000000004','b4630400-0000-4000-8000-000000000001','BANK','Destination bank','SAR','PERSONAL');
set local role authenticated;
select set_config('request.jwt.claim.sub','b4630400-0000-4000-8000-000000000001',true);
insert into public.personal_income_profiles(seller_name,vat_number,effective_from)
 values ('Synthetic seller','300000000000003','2026-01-01');

do $$
declare
 invoice public.personal_income_documents;
 precision_invoice public.personal_income_documents;
 rounding_invoice public.personal_income_documents;
 bank uuid:='b4630400-0000-4000-8000-000000000003';
 payload jsonb;
 receipt jsonb;
 before jsonb;
 final jsonb;
 entry jsonb;
 expected_net numeric;
 first_rounding_entry jsonb;
 second_rounding_entry jsonb;
 gross_seen numeric:=0;
 net_seen numeric:=0;
 vat_seen numeric:=0;
begin
 invoice:=public.record_personal_income_document(gen_random_uuid(),'SIMPLIFIED','2026-02-01',
   'Synthetic client','Consultation',null,10000,1500);
 assert public.read_personal_invoice_collection_lots_at_cutoff(invoice.id,'2026-01-31')->>'status'='NOT_RECOGNIZED_AT_CUTOFF';
 assert public.read_personal_invoice_collection_lots_at_cutoff(invoice.id,'2026-02-01')->'rows'='[]'::jsonb;

 payload:=jsonb_build_object('action','COLLECT','source_id',invoice.receivable_id,'destination_id',bank,
  'request_id',gen_random_uuid(),'date','2026-02-02','amount',4000,'notes','First collection');
 receipt:=public.transfer_personal_financial_account(payload);
 assert public.transfer_personal_financial_account(payload)=receipt;
 before:=public.read_personal_invoice_collection_lots_at_cutoff(invoice.id,'2026-02-02');
 assert before->>'status'='VERIFIED' and jsonb_array_length(before->'rows')=1 and (before->>'grossRemaining')::numeric=7500;
 entry:=before->'rows'->0;
 assert entry->>'transferId'=receipt->>'transfer_id' and entry->>'inTransactionId'=receipt->>'in_transaction_id'
   and entry->>'outTransactionId'=receipt->>'out_transaction_id';
 assert (entry->>'grossCollected')::numeric=4000 and (entry->>'netCollected')::numeric=3478.26
   and (entry->>'taxCollected')::numeric=521.74;
 assert exists(select 1 from public.lots where id=(entry->>'bankLotId')::uuid
   and hawl_continuity_source_lot_id=(entry->>'sourceReceivableLotId')::uuid);

 -- Two genuine same-day receipts need independent stable IDs and exact cents.
 perform public.transfer_personal_financial_account(payload||jsonb_build_object('request_id',gen_random_uuid(),'date','2026-02-03','amount',2000));
 perform public.transfer_personal_financial_account(payload||jsonb_build_object('request_id',gen_random_uuid(),'date','2026-02-03','amount',5500));
 final:=public.read_personal_invoice_collection_lots_at_cutoff(invoice.id,'2026-02-03');
 assert final->>'status'='VERIFIED' and jsonb_array_length(final->'rows')=3 and (final->>'grossRemaining')::numeric=0;
 for entry in select value from jsonb_array_elements(final->'rows') loop
  gross_seen:=gross_seen+(entry->>'grossCollected')::numeric;
  expected_net:=round(gross_seen*10000/11500,2)-net_seen;
  assert (entry->>'netCollected')::numeric=expected_net;
  net_seen:=net_seen+expected_net;
  vat_seen:=vat_seen+(entry->>'taxCollected')::numeric;
 end loop;
 assert gross_seen=11500 and net_seen=10000 and vat_seen=1500;
 assert (select count(distinct x->>'bankLotId') from jsonb_array_elements(final->'rows') x)=3;
 assert public.read_personal_invoice_collection_lots_at_cutoff(invoice.id,'2026-02-02')=before;

 -- Moving cash after collection leaves the original receipt basis unchanged.
 perform public.transfer_personal_financial_account(jsonb_build_object('action','TRANSFER','source_id',bank,
   'destination_id','b4630400-0000-4000-8000-000000000004','request_id',gen_random_uuid(),
   'date','2026-02-04','amount',3000,'notes','Move from original bank lot'));
 assert public.read_personal_invoice_collection_lots_at_cutoff(invoice.id,'2026-02-03')=final;
 assert (public.read_personal_invoice_collection_lots_at_cutoff(invoice.id,'2026-02-04')->'rows')=final->'rows';
 assert (public.personal_income_period('2026-02-01','2026-02-04')->>'count')::int=1;

 -- Work 04's two same-day receipts share a posting timestamp and differ by one halala when the order changes.
 rounding_invoice:=public.record_personal_income_document(gen_random_uuid(),'SIMPLIFIED','2026-02-01',
   'Same-day rounding client','Consultation',null,10000,1500);
 perform public.transfer_personal_financial_account(payload||jsonb_build_object('source_id',rounding_invoice.receivable_id,
   'request_id',gen_random_uuid(),'amount',4000));
 perform public.transfer_personal_financial_account(payload||jsonb_build_object('source_id',rounding_invoice.receivable_id,
   'destination_id','b4630400-0000-4000-8000-000000000004','request_id',gen_random_uuid(),'amount',1000.08));
 entry:=public.read_personal_invoice_collection_lots_at_cutoff(rounding_invoice.id,'2026-02-02');
 assert entry->>'status'='VERIFIED' and (entry->>'netCollected')::numeric=4347.90;
 first_rounding_entry:=entry->'rows'->0;
 second_rounding_entry:=entry->'rows'->1;
 assert first_rounding_entry->>'postedAt'=second_rounding_entry->>'postedAt';
 assert (first_rounding_entry->>'roundingOrder')::int=1 and (second_rounding_entry->>'roundingOrder')::int=2;
 assert (first_rounding_entry->>'outTransactionId')::uuid<(second_rounding_entry->>'outTransactionId')::uuid;
 assert (first_rounding_entry->>'netCollected')::numeric=round((first_rounding_entry->>'grossCollected')::numeric*10000/11500,2);
 assert (second_rounding_entry->>'netCollected')::numeric=4347.90-(first_rounding_entry->>'netCollected')::numeric;

 precision_invoice:=public.record_personal_income_document(gen_random_uuid(),'SIMPLIFIED','2026-02-01',
   'Fractional collection client','Consultation',null,10000,1500);
 perform public.transfer_personal_financial_account(payload||jsonb_build_object('source_id',precision_invoice.receivable_id,
   'request_id',gen_random_uuid(),'amount',0.005));
 assert public.read_personal_invoice_collection_lots_at_cutoff(precision_invoice.id,'2026-02-02')->>'status'
   ='COLLECTION_PRECISION_UNSUPPORTED';
 perform set_config('receipts.qa.invoice',invoice.id::text,true);
 perform set_config('receipts.qa.lot',final->'rows'->2->>'bankLotId',true);
 perform set_config('request.jwt.claim.sub','b4630400-0000-4000-8000-000000000002',true);
 begin
  perform public.read_personal_invoice_collection_lots_at_cutoff(invoice.id,'2026-02-03');
  raise exception 'Expected owner isolation';
 exception when raise_exception then
  if sqlerrm<>'PERSONAL_INVOICE_HAWL_DOCUMENT_NOT_FOUND' then raise; end if;
 end;
 assert not has_function_privilege('anon','public.read_personal_invoice_collection_lots_at_cutoff(uuid,date)','EXECUTE');
end
$$;

reset role;
update public.lots set hawl_continuity_source_lot_id=null where id=current_setting('receipts.qa.lot')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','b4630400-0000-4000-8000-000000000001',true);
do $$
declare invoice uuid:=current_setting('receipts.qa.invoice')::uuid;
begin
 assert public.read_personal_invoice_collection_lots_at_cutoff(invoice,'2026-02-02')->>'status'='VERIFIED';
 assert public.read_personal_invoice_collection_lots_at_cutoff(invoice,'2026-02-03')->>'status'='COLLECTION_LOT_SOURCE_UNVERIFIED';
 assert public.read_personal_invoice_collection_lots_at_cutoff(invoice,'2026-02-03')->'rows'='[]'::jsonb;
end
$$;
rollback;
