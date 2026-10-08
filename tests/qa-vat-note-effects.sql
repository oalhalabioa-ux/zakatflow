-- QA synthetic organization only; all changes rolled back. Runs under actual member RLS.
begin;
insert into public.organization_members(organization_id,user_id,role,status) values('5d018fd3-3a1a-4f19-922b-4f58bda5cc7b','11111111-1111-4111-8111-111111111111','ADMIN','ACTIVE') on conflict(organization_id,user_id) do nothing;
insert into public.organization_member_permission_overrides(organization_id,user_id,permission,effect) values('5d018fd3-3a1a-4f19-922b-4f58bda5cc7b','11111111-1111-4111-8111-111111111111','financial_core.approve','ALLOW') on conflict(organization_id,user_id,permission) do update set effect='ALLOW';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ce535387-cff4-494e-ad96-d942854f4b9e","role":"authenticated"}',true);
do $test$
declare original public.vat_documents%rowtype; inv public.vat_einvoices%rowtype; note public.vat_einvoices%rowtype; n jsonb; eid uuid; due numeric; bank numeric; refund numeric; idx int; settlement uuid; flow uuid; bank_id uuid; cls uuid; obligation uuid; cmd jsonb;
begin
for idx in 1..5 loop
 select * into original from public.vat_documents where organization_id='5d018fd3-3a1a-4f19-922b-4f58bda5cc7b' and document_number=case idx when 1 then 'QA-INV-002' when 2 then 'QA-INV-003' when 3 then 'QA-INV-003' else 'QA-INV-004' end;
 if original.id is null then raise exception 'QA_FIXTURE_REQUIRED'; end if;
 select * into inv from public.vat_einvoices where accounting_document_id=original.id;
 if inv.status='DRAFT' then inv:=public.issue_vat_einvoice(inv.id); end if;
 select sum(current_balance) into bank from public.liquidity_accounts where organization_id=original.organization_id;
 n:=public.create_vat_note_document(to_jsonb(original)||jsonb_build_object('document_kind',case idx when 4 then 'DEBIT_NOTE' else 'CREDIT_NOTE' end,'document_number','QA-ROLLBACK-NOTE-'||idx,'preceding_document_id',original.id,'net_amount',case when idx=5 then 4000 else 100 end,'tax_amount',case when idx=5 then 600 else 15 end,'gross_amount',case when idx=5 then 4600 else 115 end,'source_net_amount',case when idx=5 then 4000 else 100 end,'source_tax_amount',case when idx=5 then 600 else 15 end,'source_gross_amount',case when idx=5 then 4600 else 115 end,'line_items','[]'::jsonb,'notes','Rollback linked note test'));
 eid:=(n->'financial_core'->>'event_id')::uuid;
 note:=inv; note.id:=gen_random_uuid(); note.invoice_uuid:=gen_random_uuid(); note.invoice_number:=n->>'document_number'; note.document_type:=n->>'document_kind'; note.status:='DRAFT'; note.qr_code:=null; note.issued_at:=null; note.accounting_document_id:=(n->>'id')::uuid; note.preceding_invoice_id:=inv.id; note.billing_reference:=inv.invoice_number; note.note_reason:='Rollback linked note test'; note.line_extension_amount:=100; note.tax_exclusive_amount:=100; note.tax_total_amount:=15; note.tax_inclusive_amount:=115; note.payable_amount:=115; note.tax_total_amount_sar:=15; if idx=5 then note.line_extension_amount:=4000; note.tax_exclusive_amount:=4000; note.tax_total_amount:=600; note.tax_inclusive_amount:=4600; note.payable_amount:=4600; note.tax_total_amount_sar:=600; end if;
 insert into public.vat_einvoices select note.*;
 note:=public.issue_vat_einvoice(note.id);
 if note.status<>'ISSUED' or note.qr_code is null or (select zatca_status from public.vat_documents where id=note.accounting_document_id)<>'ISSUED' then raise exception 'ISSUANCE_FAILED'; end if;
 perform set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
 perform public.approve_financial_event(eid,'Rollback independent note approval');
 perform set_config('request.jwt.claims','{"sub":"ce535387-cff4-494e-ad96-d942854f4b9e","role":"authenticated"}',true);
 perform public.post_vat_financial_event(eid);
 perform public.post_vat_financial_event(eid); -- idempotent
 if (select sum(current_balance) from public.liquidity_accounts where organization_id=original.organization_id)<>bank then raise exception 'BANK_CHANGED'; end if;
 if idx=1 then
  select outstanding_base_amount into due from public.financial_event_obligation_balances where event_id='1433e9bb-b275-4025-9f81-745bf12688b6';
  if (select sum(actual_base_amount) from public.financial_budget_operational_facts where event_id=eid and classification_type='REVENUE') is distinct from -100 then raise exception 'CREDIT_ACCOUNTING_SIGN_FAILED'; end if;
  if due<>1685 then raise exception 'PARTIAL_INVOICE_WRONG_DUE:%',due; end if;
  if exists(select 1 from public.liquidity_flows where source_record_id=note.accounting_document_id) then raise exception 'UNEXPECTED_REFUND_FLOW'; end if;
 elsif idx in(2,3) then
  select settleable_base_amount into refund from public.financial_event_obligations where event_id=eid and obligation_key='note-refund' and obligation_type='PAYABLE';
  if refund is distinct from 115 then raise exception 'WRONG_INCREMENTAL_REFUND:%',refund; end if;
  if (select count(*) from public.liquidity_flows where source_record_id=note.accounting_document_id and direction='OUTFLOW' and amount=115)<>1 then raise exception 'REFUND_FORECAST_FAILED'; end if;
 elsif idx=5 then
  if not exists(select 1 from public.liquidity_flows where source_record_id=original.id and amount=0 and settled_amount=0 and settlement_status='SETTLED') then raise exception 'UNPAID_CREDIT_CLOSURE_FAILED'; end if;
 else
  if (select outstanding_base_amount from public.financial_event_obligation_balances where event_id=eid and obligation_type='RECEIVABLE')<>115 then raise exception 'DEBIT_OBLIGATION_FAILED'; end if;
  if not exists(select 1 from public.liquidity_flows where source_record_id=note.accounting_document_id and direction='INFLOW' and amount=115) then raise exception 'DEBIT_FORECAST_FAILED'; end if;
 end if;
 if idx=3 then
  select id into flow from public.liquidity_flows where source_record_id=note.accounting_document_id;
  select id into obligation from public.financial_event_obligations where event_id=eid and obligation_key='note-refund';
  select id into bank_id from public.liquidity_accounts where organization_id=original.organization_id and name='بنك تجريبي — حساب القبض';
  select id into cls from public.financial_classifications where organization_id=original.organization_id and classification_type='RECEIVABLE' limit 1;
  cmd:=to_jsonb(public.create_financial_event_command(jsonb_build_object('organization_id',original.organization_id,'entity_id','6ac2aa7d-d24a-4af6-83d3-210e15f27190','counterparty_id',(select counterparty_id from public.financial_events where id=eid),'event_type','SETTLEMENT','source_module','OPERATIONAL_CONSOLE','source_event_key','QA-ROLLBACK-REFUND','event_date',current_date,'base_currency','SAR','description','Rollback cash refund test','lines',jsonb_build_array(jsonb_build_object('line_number',1,'classification_id',cls,'amount',115,'currency','SAR','exchange_rate',1,'base_amount',115,'cash_direction','OUTFLOW','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0)),'obligations','[]'::jsonb,'links',jsonb_build_array(jsonb_build_object('link_type','SETTLEMENT_OF','related_event_id',eid)))));
  settlement:=coalesce(cmd->>'event_id',cmd->>'id',trim(both '"' from cmd::text))::uuid;
  perform public.transition_financial_event(settlement,'PLANNED','Rollback refund');
  perform public.transition_financial_event(settlement,'COMMITTED','Rollback refund');
  perform public.approve_financial_event(settlement,'Rollback approved refund');
  perform public.post_financial_settlement(settlement,bank_id,'OUTFLOW',current_date,115,'SAR',1,115,jsonb_build_array(jsonb_build_object('obligation_id',obligation,'flow_id',flow,'amount',115,'base_amount',115,'flow_amount',115,'flow_currency','SAR','flow_exchange_rate',1)));
  if (select sum(current_balance) from public.liquidity_accounts where organization_id=original.organization_id)<>bank-115 then raise exception 'REFUND_BANK_EFFECT_FAILED'; end if;
 end if;
end loop;
-- A further credit against the fully credited original cannot be issued.
n:=public.create_vat_note_document(to_jsonb(original)||jsonb_build_object('document_kind','CREDIT_NOTE','document_number','QA-ROLLBACK-EXCESS','preceding_document_id',original.id,'net_amount',100,'tax_amount',15,'gross_amount',115,'source_net_amount',100,'source_tax_amount',15,'source_gross_amount',115,'line_items','[]'::jsonb,'notes','Rollback excess credit test'));
eid:=(n->'financial_core'->>'event_id')::uuid;
note:=inv; note.id:=gen_random_uuid(); note.invoice_uuid:=gen_random_uuid(); note.invoice_number:=n->>'document_number'; note.document_type:='CREDIT_NOTE'; note.status:='DRAFT'; note.qr_code:=null; note.issued_at:=null; note.accounting_document_id:=(n->>'id')::uuid; note.preceding_invoice_id:=inv.id; note.billing_reference:=inv.invoice_number; note.note_reason:='Rollback excess credit test'; note.line_extension_amount:=100; note.tax_exclusive_amount:=100; note.tax_total_amount:=15; note.tax_inclusive_amount:=115; note.payable_amount:=115; note.tax_total_amount_sar:=15;
insert into public.vat_einvoices select note.*;
begin
 perform public.issue_vat_einvoice(note.id);
 raise exception 'EXCESS_CREDIT_WAS_ALLOWED';
exception when raise_exception then if sqlerrm<>'VAT_CREDIT_EXCEEDS_ORIGINAL' then raise; end if; end;
perform public.delete_unissued_zatca_draft_bundle(note.id);
if exists(select 1 from public.vat_documents where id=note.accounting_document_id) or exists(select 1 from public.financial_events where id=eid) then raise exception 'NOTE_DRAFT_BUNDLE_DELETE_FAILED'; end if;
begin
 perform public.create_vat_note_document(to_jsonb(original)||jsonb_build_object('document_kind','CREDIT_NOTE','document_number','QA-ROLLBACK-BAD-DATE','preceding_document_id',original.id,'transaction_date',original.transaction_date-1,'notes','Invalid tax date'));
 raise exception 'BAD_DATE_WAS_ALLOWED';
exception when raise_exception then if sqlerrm<>'VAT_NOTE_DATE_BEFORE_ORIGINAL' then raise; end if; end;
begin
 insert into public.vat_period_summaries(organization_id,period_start,period_end,filing_status,filed_at,created_by) values(original.organization_id,original.transaction_date,original.transaction_date,'FILED',now(),auth.uid());
 begin
  perform public.create_vat_note_document(to_jsonb(original)||jsonb_build_object('document_kind','CREDIT_NOTE','document_number','QA-ROLLBACK-FILED','preceding_document_id',original.id,'notes','Filed period test'));
  raise exception 'FILED_PERIOD_WAS_ALLOWED';
 exception when raise_exception then if sqlerrm<>'VAT_NOTE_FILED_PERIOD_LOCKED' then raise; end if; end;
 raise exception 'ROLLBACK_FILED_FIXTURE';
exception when raise_exception then if sqlerrm<>'ROLLBACK_FILED_FIXTURE' then raise; end if; end;
end $test$;
rollback;
select 'linked issuance, partial credit, full-paid credit, incremental refund, debit, idempotency, unchanged bank on recognition, actual cash refund, unpaid closure, signed accounting, excess credit/date/filed-period guards, draft bundle deletion: PASS' as verification;
