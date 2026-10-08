-- Run only against Financial Core QA. Every synthetic row is rolled back.
begin;
-- QA retains an old Phase 2C flow trigger absent from the current Production schema.
-- Disable only that legacy trigger inside this rollback-only transaction for Production parity.
alter table public.liquidity_flows disable trigger phase2c_expected_integrity;
-- Mirror current Production core write grants and owner/admin RLS only within this test transaction.
-- QA omits the application audit table; emulate its insert contract inside the transaction.
create table if not exists public.audit_logs(id uuid primary key default gen_random_uuid(),user_id uuid,entity_type text,entity_id uuid,action text,old_data jsonb,new_data jsonb);
alter table public.audit_logs enable row level security;
create policy review_qa_audit_insert on public.audit_logs for insert to authenticated with check(user_id=auth.uid());
grant insert on public.audit_logs to authenticated;
grant update on public.liquidity_flows to authenticated;
-- Match Production's column-scoped customer projection permission, without widening it.
grant insert(organization_id,name,party_type,contact_name,phone,email,notes) on public.liquidity_counterparties to authenticated;
grant insert on public.financial_vat_counterparty_map to authenticated;
create policy review_qa_map_insert on public.financial_vat_counterparty_map for insert to authenticated with check(
 private.can_write_liquidity(organization_id) and created_by=auth.uid()
 and exists(select 1 from public.vat_contacts c where c.id=vat_contact_id and c.organization_id=financial_vat_counterparty_map.organization_id)
 and exists(select 1 from public.liquidity_counterparties c where c.id=counterparty_id and c.organization_id=financial_vat_counterparty_map.organization_id));
grant update,insert,delete on public.financial_events,public.financial_event_lines,public.financial_event_links,public.financial_event_obligations to authenticated;
-- Financial Core owner/admin authorization baseline.
-- RLS controls tenant scope; accounting immutability remains enforced by constraints/triggers/RPCs.
do $$
declare t text;
begin
  foreach t in array array[
    'financial_events','financial_event_lines','financial_event_obligations',
    'financial_event_obligation_allocations','financial_event_links','financial_event_status_history'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t||'_owner_admin_all',t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id))',
      t||'_owner_admin_all',t
    );
  end loop;
end $$;

select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $seed$
declare org uuid:='20000000-0000-4000-8000-000000000002';
 e public.financial_events%rowtype; inv public.vat_einvoices%rowtype; c public.vat_contacts%rowtype; cp uuid;
 doc uuid:=gen_random_uuid(); eid uuid:=gen_random_uuid(); flow uuid:=gen_random_uuid(); iid uuid:=gen_random_uuid(); rid uuid:=gen_random_uuid(); account uuid; new_contact uuid:=gen_random_uuid();
begin
 select * into c from public.vat_contacts where organization_id=org and contact_type in('CUSTOMER','BOTH') limit 1;
 select counterparty_id into cp from public.financial_vat_counterparty_map where organization_id=org and vat_contact_id=c.id;
 if cp is null then raise exception 'QA_CONTACT_FIXTURE_REQUIRED'; end if;
 insert into public.vat_contacts select (jsonb_populate_record(c,jsonb_build_object('id',new_contact,'name','QA replacement customer'))).*;
 perform set_config('qa.new_contact_id',new_contact::text,true);
 select id into account from public.liquidity_accounts where organization_id=org and currency='SAR' and active limit 1;
 if account is null then raise exception 'QA_ACCOUNT_FIXTURE_REQUIRED'; end if;
 insert into public.vat_documents(id,organization_id,user_id,created_by,document_type,document_kind,document_number,transaction_date,due_date,counterparty_contact_id,counterparty_name,supply_type,net_amount,tax_rate,tax_amount,gross_amount,currency,source_currency,exchange_rate,source_net_amount,source_tax_amount,source_gross_amount)
 values(doc,org,auth.uid(),auth.uid(),'SALES','INVOICE','REVIEW-QA-'||doc,current_date,current_date,c.id,c.name,'STANDARD',100,15,15,115,'SAR','SAR',1,100,15,115);
 select * into e from public.financial_events where organization_id=org and event_type='REVENUE' and status='DRAFT' limit 1;
 insert into public.financial_events select (jsonb_populate_record(e,jsonb_build_object('id',eid,'source_event_key','review:'||eid,'source_record_id',doc,'source_module','OPERATIONAL_CONSOLE','created_by',auth.uid(),'counterparty_id',cp,'status','DRAFT'))).*;
 insert into public.financial_event_lines(event_id,organization_id,line_number,description,classification_id,amount,currency,exchange_rate,base_amount,cash_direction,vat_treatment,vat_rate,vat_amount)
 select eid,org,case classification_type when 'REVENUE' then 1 else 2 end,'QA sales',id,case classification_type when 'REVENUE' then 100 else 15 end,'SAR',1,case classification_type when 'REVENUE' then 100 else 15 end,'NON_CASH','OUT_OF_SCOPE',0,0 from public.financial_classifications where organization_id=org and classification_type in('REVENUE','TAX');
 insert into public.financial_event_obligations(event_id,organization_id,obligation_key,obligation_type,settleable_amount,currency,exchange_rate,base_currency,settleable_base_amount)
 values(eid,org,'invoice-gross','RECEIVABLE',115,'SAR',1,'SAR',115);
 insert into public.liquidity_flows(id,organization_id,direction,flow_type,title,due_date,amount,currency,base_amount,status,source,source_module,source_record_id,source_event_key,counterparty_id)
 values(flow,org,'INFLOW','OPERATING','QA receivable',current_date,115,'SAR',115,'EXPECTED','INVOICE','VAT_INTEGRATION',doc,'review:'||flow,cp);
 insert into public.financial_event_links(event_id,organization_id,link_type,target_module,target_record_id)
 values(eid,org,'SOURCE','vat_documents',doc),(eid,org,'CASH_FLOW','liquidity_flows',flow);
 select * into inv from public.vat_einvoices where organization_id=org limit 1;
 insert into public.vat_einvoices select (jsonb_populate_record(inv,jsonb_build_object('id',iid,'invoice_uuid',gen_random_uuid(),'invoice_number','REVIEW-QA-'||doc,'status','DRAFT','accounting_document_id',doc,'buyer_contact_id',c.id,'buyer_name',c.name,'currency','SAR','exchange_rate',1,'issue_date',current_date,'due_date',current_date,'issued_at',null,'qr_code',null,'created_by',auth.uid()))).*;
 insert into public.financial_events select (jsonb_populate_record(e,jsonb_build_object('id',rid,'source_event_key','review:'||rid,'source_record_id',null,'source_module','OPERATIONAL_CONSOLE','created_by',auth.uid(),'event_type','SETTLEMENT','counterparty_id',cp,'status','DRAFT'))).*;
 insert into public.financial_event_lines(event_id,organization_id,line_number,description,classification_id,amount,currency,exchange_rate,base_amount,cash_direction,vat_treatment,vat_rate,vat_amount)
 select rid,org,1,'QA receipt',id,40,'SAR',1,40,'INFLOW','OUT_OF_SCOPE',0,0 from public.financial_classifications where organization_id=org and classification_type='RECEIVABLE' limit 1;
 insert into public.financial_event_links(event_id,organization_id,link_type,target_module,target_record_id,metadata)
 values(rid,org,'OTHER','liquidity_flows',flow,jsonb_build_object('purpose','SETTLEMENT_INSTRUCTION','account_id',account,'settlement_date',current_date,'amount',40,'base_amount',40,'flow_amount',40,'currency','SAR','exchange_rate',1,'obligation_id',(select id from public.financial_event_obligations where event_id=eid)));
 perform set_config('qa.invoice_id',iid::text,true); perform set_config('qa.document_id',doc::text,true);
 perform set_config('qa.event_id',eid::text,true); perform set_config('qa.flow_id',flow::text,true);
 perform set_config('qa.receipt_id',rid::text,true); perform set_config('qa.account_id',account::text,true);
end $seed$;
set local role authenticated;
do $test$
declare iid uuid:=current_setting('qa.invoice_id')::uuid; doc uuid:=current_setting('qa.document_id')::uuid;
 eid uuid:=current_setting('qa.event_id')::uuid; flow uuid:=current_setting('qa.flow_id')::uuid;
 rid uuid:=current_setting('qa.receipt_id')::uuid; account uuid:=current_setting('qa.account_id')::uuid; h jsonb; l jsonb; r jsonb;
begin
 select to_jsonb(e) into h from public.vat_einvoices e where id=iid;
 h:=h||jsonb_build_object('tax_exclusive_amount',200,'line_extension_amount',200,'tax_total_amount',30,'tax_inclusive_amount',230,'payable_amount',230,'tax_total_amount_sar',30);
 l:='[{"line_number":1,"item_name":"QA service","quantity":1,"unit_code":"PCE","unit_price":200,"discount_amount":0,"tax_category":"S","tax_rate":15,"line_extension_amount":200,"tax_amount":30,"gross_amount":230}]';
 -- Existing pending receipt prevents changing its invoice underneath it.
 begin perform public.amend_zatca_draft_atomic(iid,h,l); raise exception 'QA_EXPECTED_PENDING_RECEIPT_LOCK';
 exception when raise_exception then if sqlerrm<>'VAT_DOCUMENT_SETTLED_LOCKED' then raise; end if; end;
 r:=public.amend_pending_invoice_receipt(rid,account,current_date,50);
 if (select amount from public.financial_event_lines where event_id=rid)<>50 then raise exception 'QA_RECEIPT_AMEND_FAILED'; end if;
 begin perform public.amend_pending_invoice_receipt(rid,account,current_date,116); raise exception 'QA_EXPECTED_OVER_RECEIPT';
 exception when raise_exception then if sqlerrm<>'SETTLEMENT_EXCEEDS_FLOW_OUTSTANDING' then raise; end if; end;
 -- Cancel the synthetic instruction so the sales amendment can proceed.
 update public.financial_events set status='CANCELLED' where id=rid;
 begin perform public.amend_pending_invoice_receipt(rid,account,current_date,55); raise exception 'QA_EXPECTED_CANCELLED_RECEIPT_LOCK';
 exception when raise_exception then if sqlerrm<>'RECEIPT_EDIT_LOCKED' then raise; end if; end;
 r:=public.amend_zatca_draft_atomic(iid,h,l);
 if (select gross_amount from public.vat_documents where id=doc)<>230
   or (select amount from public.liquidity_flows where id=flow)<>230
   or (select settleable_amount from public.financial_event_obligations where event_id=eid)<>230 then raise exception 'QA_FINANCIAL_SYNC_FAILED'; end if;
 begin perform public.amend_zatca_draft_atomic(iid,h||jsonb_build_object('line_extension_amount',400,'tax_exclusive_amount',400,'tax_total_amount',60,'tax_total_amount_sar',60,'tax_inclusive_amount',460,'payable_amount',460),l||l); raise exception 'QA_EXPECTED_DUPLICATE_LINE';
 exception when unique_violation then null; end;
 if (select count(*) from public.vat_einvoice_lines where invoice_id=iid)<>1
   or (select payable_amount from public.vat_einvoices where id=iid)<>230
   or (select gross_amount from public.vat_documents where id=doc)<>230 then raise exception 'QA_ATOMIC_ROLLBACK_FAILED'; end if;
 h:=h||jsonb_build_object('currency','USD','exchange_rate',3.75,'tax_total_amount_sar',112.50);
 r:=public.amend_zatca_draft_atomic(iid,h,l);
 if (select source_gross_amount from public.vat_documents where id=doc)<>230
   or (select gross_amount from public.vat_documents where id=doc)<>862.50
   or (select amount from public.liquidity_flows where id=flow)<>862.50 then raise exception 'QA_MULTICURRENCY_SYNC_FAILED'; end if;
 h:=h||jsonb_build_object('buyer_contact_id',current_setting('qa.new_contact_id'),'buyer_name','QA replacement customer');
 r:=public.amend_zatca_draft_atomic(iid,h,l);
 if not exists(select 1 from public.financial_vat_counterparty_map m join public.financial_events e on e.counterparty_id=m.counterparty_id
   join public.liquidity_flows f on f.counterparty_id=m.counterparty_id
   where m.vat_contact_id=current_setting('qa.new_contact_id')::uuid and e.id=eid and f.id=flow) then raise exception 'QA_CUSTOMER_SYNC_FAILED'; end if;
 perform set_config('request.jwt.claims','{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated"}',true);
 perform set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',true);
 begin perform public.amend_zatca_draft_atomic(iid,h,l); raise exception 'QA_EXPECTED_TENANT_LOCK';
 exception when raise_exception then if sqlerrm<>'EINVOICE_DRAFT_NOT_FOUND' then raise; end if; end;
 begin perform public.amend_pending_invoice_receipt(rid,account,current_date,50); raise exception 'QA_EXPECTED_RECEIPT_TENANT_LOCK';
 exception when raise_exception then if sqlerrm<>'RECEIPT_NOT_FOUND' then raise; end if; end;
end $test$;
rollback;
select 'PASS: pending receipt edits, over-collection rejection, invoice/obligation/flow synchronization, atomic rollback; all fixtures rolled back' as result;
