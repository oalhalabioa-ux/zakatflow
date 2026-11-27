begin;
insert into auth.users(id,email,email_confirmed_at)
 values('b4630441-0000-4000-8000-000000000001','work04-invoice@example.invalid',now());
insert into public.profiles(id,base_currency)
 values('b4630441-0000-4000-8000-000000000001','SAR') on conflict(id) do update set base_currency=excluded.base_currency;
insert into public.personal_income_issuers(owner_id,vat_number,address,valid_from,valid_until)
 values ('b4630441-0000-4000-8000-000000000001','300000000000003','Synthetic address','2025-01-01','2099-12-31');
set local role authenticated;
select set_config('request.jwt.claim.sub','b4630441-0000-4000-8000-000000000001',true);
insert into public.personal_income_profiles(seller_name,vat_number,effective_from)
 values ('Work 04 synthetic practice','300000000000003','2026-01-01');

do $$
declare
 actor uuid:=auth.uid();
 invoice public.personal_income_documents;
 first_bank uuid;
 second_bank uuid;
 middle_bank uuid;
 final_bank uuid;
 first_bank_lot uuid;
 middle_lot public.lots;
 final_lot public.lots;
 first_move jsonb;
 second_move jsonb;
 first_evidence jsonb;
 first_net numeric;
 first_remaining numeric;
 as_of_before jsonb;
 receipt_snapshot jsonb;
 historical_debt jsonb;
 first_payload jsonb;
 first_receipt jsonb;
 second_receipt jsonb;
 cutoff jsonb;
 invoice_net numeric:=10000;
 invoice_gross numeric:=11500;
 first_gross numeric:=4000;
 second_gross numeric:=1000.08;

begin
 insert into public.asset_accounts(user_id,asset_type,name,currency,ownership_scope,is_zakatable)
 values(actor,'BANK','Synthetic bank A','SAR','PERSONAL',true) returning id into first_bank;
 insert into public.asset_accounts(user_id,asset_type,name,currency,ownership_scope,is_zakatable)
 values(actor,'BANK','Synthetic bank B','SAR','PERSONAL',true) returning id into second_bank;
 invoice:=public.record_personal_income_document(gen_random_uuid(),'SIMPLIFIED','2026-02-01',
   'Synthetic recipient','Synthetic fee',null,invoice_net,1500);
 perform public.record_personal_invoice_hawl_event(invoice.id,gen_random_uuid(),'2026-02-03','GOOD','2026-02-01');
 first_payload:=jsonb_build_object('action','COLLECT','source_id',invoice.receivable_id,'destination_id',first_bank,
   'request_id',gen_random_uuid(),'date','2026-02-06','amount',first_gross,'notes','First synthetic same-day collection');
 first_receipt:=public.transfer_personal_financial_account(first_payload);
 second_receipt:=public.transfer_personal_financial_account(jsonb_build_object(
   'action','COLLECT','source_id',invoice.receivable_id,'destination_id',second_bank,
   'request_id',gen_random_uuid(),'date','2026-02-06','amount',second_gross,'notes','Second synthetic same-day collection'));
 assert public.transfer_personal_financial_account(first_payload)=first_receipt;
 assert (select count(*)=4 and count(distinct created_at)=1 from public.transactions
   where transfer_id in ((first_receipt->>'transfer_id')::uuid,(second_receipt->>'transfer_id')::uuid));
 assert (select count(*) from public.lots where asset_account_id in (first_bank,second_bank))=2;
 assert (select sum(remaining_value_base) from public.lots where asset_account_id=first_bank)=first_gross;
 assert (select sum(remaining_value_base) from public.lots where asset_account_id=second_bank)=second_gross;
 assert (public.read_personal_invoice_hawl_at_cutoff(invoice.id,'2026-02-05')->>'netCollected')::numeric=0;
 cutoff:=public.read_personal_invoice_hawl_at_cutoff(invoice.id,'2026-02-06');
 assert cutoff->>'status'='VERIFIED';
 assert (cutoff->>'netCollected')::numeric=4347.90;
 assert (cutoff->>'netRemaining')::numeric=5652.10;
 receipt_snapshot:=public.read_personal_invoice_collection_lots_at_cutoff(invoice.id,'2026-02-06');
 assert receipt_snapshot->>'status'='VERIFIED';
 assert (receipt_snapshot->>'netCollected')::numeric=4347.90;
 assert jsonb_array_length(receipt_snapshot->'rows')=2;
 assert receipt_snapshot=public.read_personal_invoice_collection_lots_at_cutoff(invoice.id,'2026-02-06');
 select elem into first_evidence from jsonb_array_elements(receipt_snapshot->'rows') elem
   where elem->>'inTransactionId'=first_receipt->>'in_transaction_id';
 first_bank_lot:=(first_evidence->>'bankLotId')::uuid;
 first_net:=(first_evidence->>'netCollected')::numeric;
 assert (first_evidence->>'grossCollected')::numeric=4000 and
   first_net+(first_evidence->>'taxCollected')::numeric=4000;
 assert ((receipt_snapshot->'rows'->0->>'outTransactionId')::uuid)
      < ((receipt_snapshot->'rows'->1->>'outTransactionId')::uuid);
 as_of_before:=public.read_personal_invoice_collection_lots_at_cutoff(invoice.id,'2026-02-05');
 historical_debt:=public.read_personal_invoice_hawl_at_cutoff(invoice.id,'2026-02-05');
 assert jsonb_array_length(as_of_before->'rows')=0 and (historical_debt->>'netRemaining')::numeric=10000;

 insert into public.asset_accounts(user_id,asset_type,name,currency,ownership_scope,is_zakatable)
 values(actor,'BANK','Synthetic bridge','SAR','PERSONAL',true) returning id into middle_bank;
 insert into public.asset_accounts(user_id,asset_type,name,currency,ownership_scope,is_zakatable)
 values(actor,'BANK','Synthetic third bank','SAR','PERSONAL',true) returning id into final_bank;
 first_move:=public.transfer_personal_financial_account(jsonb_build_object('action','TRANSFER','source_id',first_bank,'destination_id',middle_bank,
  'request_id',gen_random_uuid(),'date','2026-02-07','amount',1000,'notes','Move 1,000 from the first receipt only'));
 second_move:=public.transfer_personal_financial_account(jsonb_build_object('action','TRANSFER','source_id',middle_bank,'destination_id',final_bank,
  'request_id',gen_random_uuid(),'date','2026-02-08','amount',500,'notes','Move 500 along the same FIFO path'));
 select * into strict middle_lot from public.lots where source_transaction_id=(first_move->>'in_transaction_id')::uuid;
 select * into strict final_lot from public.lots where source_transaction_id=(second_move->>'in_transaction_id')::uuid;
 select remaining_value_base into strict first_remaining from public.lots where id=first_bank_lot and user_id=actor;
 assert middle_lot.hawl_continuity_source_lot_id=first_bank_lot and final_lot.hawl_continuity_source_lot_id=middle_lot.id;
 assert exists(select 1 from public.transaction_allocations
  where user_id=actor and transaction_id=(first_move->>'out_transaction_id')::uuid and lot_id=first_bank_lot and value_base=1000);
 assert exists(select 1 from public.transaction_allocations
  where user_id=actor and transaction_id=(second_move->>'out_transaction_id')::uuid and lot_id=middle_lot.id and value_base=500);
 assert receipt_snapshot->'rows'=public.read_personal_invoice_collection_lots_at_cutoff(invoice.id,'2026-02-08')->'rows';
 assert as_of_before=public.read_personal_invoice_collection_lots_at_cutoff(invoice.id,'2026-02-05');
 assert historical_debt=public.read_personal_invoice_hawl_at_cutoff(invoice.id,'2026-02-05');
 perform set_config('work04.same_day',jsonb_build_object(
  'dailyNet',cutoff->'netCollected',
  'firstRemainingGross',first_remaining,'childRemainingGross',middle_lot.remaining_value_base,'grandchildRemainingGross',final_lot.remaining_value_base,
  'firstRootGross',4000,'firstRootNet',first_net,
  'threeRemainingNet',round(first_net*(first_remaining+middle_lot.remaining_value_base+final_lot.remaining_value_base)/4000,8),
  'sourceGlobalNet',(cutoff->>'netCollected')::numeric+(cutoff->>'netRemaining')::numeric,
  'stableOrder',true,'collectedLateDidNotChangeEarlier',true)::text,true);
end
$$;
select current_setting('work04.same_day')::jsonb as descendant_result;
rollback;
