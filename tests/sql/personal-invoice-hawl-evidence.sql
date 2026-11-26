begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('b4630300-0000-4000-8000-000000000001','hawl-invoice-owner@example.invalid',now()),
 ('b4630300-0000-4000-8000-000000000002','hawl-invoice-other@example.invalid',now());
insert into public.profiles(id,base_currency) values
 ('b4630300-0000-4000-8000-000000000001','SAR'),('b4630300-0000-4000-8000-000000000002','SAR')
 on conflict(id) do update set base_currency=excluded.base_currency;
insert into public.personal_income_issuers(owner_id,vat_number,address,valid_from,valid_until) values
 ('b4630300-0000-4000-8000-000000000001','300000000000003','Synthetic address','2025-01-01','2099-12-31');
insert into public.asset_accounts(id,user_id,asset_type,name,currency,ownership_scope) values
 ('b4630300-0000-4000-8000-000000000003','b4630300-0000-4000-8000-000000000001','BANK','Synthetic bank','SAR','PERSONAL');
set local role authenticated;
select set_config('request.jwt.claim.sub','b4630300-0000-4000-8000-000000000001',true);
insert into public.personal_income_profiles(seller_name,vat_number,effective_from)
 values ('Synthetic seller','300000000000003','2026-01-01');

do $$
declare
 invoice public.personal_income_documents;
 request_id uuid:=gen_random_uuid();
 initial_event public.personal_invoice_hawl_events;
 bank uuid:='b4630300-0000-4000-8000-000000000003';
 snapshot jsonb;
begin
 invoice:=public.record_personal_income_document(gen_random_uuid(),'SIMPLIFIED','2026-02-01',
  'Synthetic client','Consultation',null,10000,1500);
 assert public.read_personal_invoice_hawl_at_cutoff(invoice.id,'2026-01-31')->>'status'='NOT_RECOGNIZED_AT_CUTOFF';
 assert public.read_personal_invoice_hawl_at_cutoff(invoice.id,'2026-02-01')->>'status'='MISSING_TERMS';

 initial_event:=public.record_personal_invoice_hawl_event(invoice.id,request_id,'2026-02-03','GOOD','2026-02-01');
 assert initial_event.id=(public.record_personal_invoice_hawl_event(invoice.id,request_id,'2026-02-03','GOOD','2026-02-01')).id;
 begin
  perform public.record_personal_invoice_hawl_event(invoice.id,request_id,'2026-02-03','BAD','2026-02-01');
  raise exception 'Expected retry conflict';
 exception when raise_exception then
  if sqlerrm<>'PERSONAL_INVOICE_HAWL_REQUEST_CONFLICT' then raise; end if;
 end;
 perform public.record_personal_invoice_hawl_event(invoice.id,gen_random_uuid(),'2026-02-03','EXCELLENT','2026-02-04');
 perform public.record_personal_invoice_hawl_event(invoice.id,gen_random_uuid(),'2026-02-03','BAD','2026-02-05');
 perform public.record_personal_invoice_hawl_event(invoice.id,gen_random_uuid(),'2026-02-03','GOOD','2026-02-08');
 -- On the same date the last recorded status wins without inventing an overnight break.
 perform public.record_personal_invoice_hawl_event(invoice.id,gen_random_uuid(),'2026-02-03','BAD','2026-02-09');
 perform public.record_personal_invoice_hawl_event(invoice.id,gen_random_uuid(),'2026-02-03','EXCELLENT','2026-02-09');
 perform public.record_personal_invoice_hawl_event(invoice.id,gen_random_uuid(),'2026-02-03','BAD','2026-02-10');

 assert (public.read_personal_invoice_hawl_at_cutoff(invoice.id,'2026-02-02')->>'netEligibleReceivable')::numeric=0;
 assert public.read_personal_invoice_hawl_at_cutoff(invoice.id,'2026-02-04')->>'receivableEligibleSince'='2026-02-03';
 assert public.read_personal_invoice_hawl_at_cutoff(invoice.id,'2026-02-05')->>'receivableEligibleSince' is null;

 perform public.transfer_personal_financial_account(jsonb_build_object('action','COLLECT','source_id',invoice.receivable_id,
   'destination_id',bank,'request_id',gen_random_uuid(),'date','2026-02-06','amount',4000,'notes','Partial synthetic collection'));
 snapshot:=public.read_personal_invoice_hawl_at_cutoff(invoice.id,'2026-02-06');
 assert (snapshot->>'grossRemaining')::numeric=7500 and (snapshot->>'netCollected')::numeric=3478.26
   and (snapshot->>'netRemaining')::numeric=6521.74 and (snapshot->>'netEligibleReceivable')::numeric=0;
 snapshot:=public.read_personal_invoice_hawl_at_cutoff(invoice.id,'2026-02-08');
 assert snapshot->>'receivableEligibleSince'='2026-02-08' and (snapshot->>'netEligibleReceivable')::numeric=6521.74;
 assert public.read_personal_invoice_hawl_at_cutoff(invoice.id,'2026-02-09')->>'receivableEligibleSince'='2026-02-08';

 perform public.transfer_personal_financial_account(jsonb_build_object('action','COLLECT','source_id',invoice.receivable_id,
   'destination_id',bank,'request_id',gen_random_uuid(),'date','2026-02-11','amount',7500,'notes','Final synthetic collection'));
 snapshot:=public.read_personal_invoice_hawl_at_cutoff(invoice.id,'2026-02-11');
 assert (snapshot->>'netCollected')::numeric=10000 and (snapshot->>'netRemaining')::numeric=0
   and snapshot->>'receivableEligibleSince' is null;

 -- A later due-date change leaves earlier cutoffs intact.
 perform public.record_personal_invoice_hawl_event(invoice.id,gen_random_uuid(),'2026-02-12','GOOD','2026-02-07');
 assert public.read_personal_invoice_hawl_at_cutoff(invoice.id,'2026-02-04')->>'dueDate'='2026-02-03';
 assert public.read_personal_invoice_hawl_at_cutoff(invoice.id,'2026-02-07')->>'dueDate'='2026-02-12';
 assert (public.personal_income_period('2026-02-01','2026-02-11')->>'net')::numeric=10000;

 perform set_config('request.jwt.claim.sub','b4630300-0000-4000-8000-000000000002',true);
 assert not exists(select 1 from public.personal_invoice_hawl_events where document_id=invoice.id);
 begin
  perform public.read_personal_invoice_hawl_at_cutoff(invoice.id,'2026-02-08');
  raise exception 'Expected isolated read to be denied';
 exception when raise_exception then
  if sqlerrm<>'PERSONAL_INVOICE_HAWL_DOCUMENT_NOT_FOUND' then raise; end if;
 end;
 begin
  perform public.record_personal_invoice_hawl_event(invoice.id,gen_random_uuid(),'2026-02-03','GOOD','2026-02-01');
  raise exception 'Expected isolated write to be denied';
 exception when raise_exception then
  if sqlerrm<>'PERSONAL_INVOICE_HAWL_DOCUMENT_NOT_FOUND' then raise; end if;
 end;
 assert not has_table_privilege('authenticated','public.personal_invoice_hawl_events','UPDATE');
 assert not has_table_privilege('authenticated','public.personal_invoice_hawl_events','INSERT');
 assert not has_function_privilege('anon','public.read_personal_invoice_hawl_at_cutoff(uuid,date)','EXECUTE');
end
$$;

rollback;
