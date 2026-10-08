-- QA ONLY. Set qa.review_email to the requested existing QA account before running.
-- Synthetic organization/data only; no Production values, credentials or identifiers.
begin;
do $seed$
declare
 u uuid; org uuid:=gen_random_uuid(); entity uuid:=gen_random_uuid(); contact uuid:=gen_random_uuid(); party uuid:=gen_random_uuid();
 bank uuid:=gen_random_uuid(); rev uuid:=gen_random_uuid(); tax uuid:=gen_random_uuid(); ar uuid:=gen_random_uuid();
 doc uuid; invoice uuid; flow uuid; event uuid; receipt uuid; obligation uuid; result jsonb; n integer;
 net numeric; vat numeric; gross numeric; rate numeric; base_net numeric; base_tax numeric; amount numeric; curr text; label text;
begin
 select id into u from auth.users where lower(email)=lower(current_setting('qa.review_email',true));
 if u is null then raise exception 'QA_REVIEW_ACCOUNT_NOT_FOUND'; end if;
 if exists(select 1 from public.organizations o join public.qa_invoice_review_scopes s on s.organization_id=o.id where o.owner_user_id=u) then
  raise exception 'QA_REVIEW_FIXTURES_ALREADY_EXIST'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.organizations(id,name,legal_name,owner_user_id,entity_type,organization_kind,base_currency,approval_policy,sort_order)
 values(org,'مراجعة الفواتير والسيولة — بيانات تجريبية','QA_ONLY_INVOICE_REVIEW',u,'COMPANY','SUBSIDIARY','SAR','OWNER_CONTROLLED',1);
 insert into public.organization_members(organization_id,user_id,role,status) values(org,u,'OWNER','ACTIVE');
 insert into public.qa_invoice_review_scopes(organization_id) values(org);
 insert into public.organization_entities(id,organization_id,name,entity_type,base_currency)
 values(entity,org,'الجهة التجريبية للفواتير','COMPANY','SAR');
 insert into public.vat_profiles(organization_id,registration_status,tax_registration_number,registration_date,filing_frequency,standard_rate,
  registered_name,seller_street,seller_building_number,seller_district,seller_additional_number,seller_city,seller_postal_code,created_by)
 values(org,'REGISTERED','303123456789013',current_date-365,'QUARTERLY',15,'شركة تجريبية لمراجعة الفواتير','شارع الاختبار','1001','حي الاختبار','2002','الرياض','12345',u);
 insert into public.vat_contacts(id,organization_id,contact_type,name,vat_number,street,building_number,district,additional_number,city,postal_code,country_code,created_by)
 values(contact,org,'CUSTOMER','عميل تجريبي — غير حقيقي','303987654321013','شارع تجريبي','3003','حي التجربة','4004','الرياض','12345','SA',u);
 insert into public.liquidity_counterparties(id,organization_id,name,party_type,notes,created_by)
 values(party,org,'عميل تجريبي — غير حقيقي','CUSTOMER','VAT identity projection: '||contact,u);
 insert into public.financial_vat_counterparty_map(organization_id,vat_contact_id,counterparty_id,created_by) values(org,contact,party,u);
 insert into public.liquidity_accounts(id,organization_id,name,account_type,currency,notes,created_by)
 values(bank,org,'بنك تجريبي — حساب القبض','BANK','SAR','QA_ONLY: no real bank or money',u);
 insert into public.liquidity_accounts(organization_id,name,account_type,currency,notes,created_by)
 values(org,'بنك تجريبي بديل','BANK','SAR','QA_ONLY: alternative receipt account',u);
 insert into public.financial_classifications(id,organization_id,code,name,classification_type,created_by)
 values(rev,org,'QA_SALES','إيراد المبيعات التجريبية','REVENUE',u),(tax,org,'QA_VAT','ضريبة تجريبية','TAX',u),(ar,org,'QA_AR','ذمم العملاء التجريبية','RECEIVABLE',u);

 for n in 1..5 loop
  doc:=gen_random_uuid(); invoice:=gen_random_uuid(); flow:=gen_random_uuid();
  net:=case n when 5 then 500 else n*1000 end; vat:=round(net*0.15,2); gross:=net+vat;
  curr:=case n when 5 then 'USD' else 'SAR' end; rate:=case n when 5 then 3.75 else 1 end;
  base_net:=round(net*rate,2); base_tax:=round(vat*rate,2); label:='QA-INV-00'||n;
  insert into public.vat_documents(id,organization_id,user_id,created_by,document_type,document_kind,document_number,transaction_date,due_date,
   counterparty_contact_id,counterparty_name,counterparty_tax_number,supply_type,net_amount,tax_rate,tax_amount,gross_amount,currency,
   source_currency,exchange_rate,source_net_amount,source_tax_amount,source_gross_amount,line_items,notes)
  values(doc,org,u,u,'SALES','INVOICE',label,current_date,current_date+14,contact,'عميل تجريبي — غير حقيقي','303987654321013','STANDARD',
   base_net,15,base_tax,base_net+base_tax,'SAR',curr,rate,net,vat,gross,
   jsonb_build_array(jsonb_build_object('description','خدمة اختبار '||n,'unit','PCE','quantity','1','unit_price',base_net::text,'source_unit_price',net::text,
   'discount_amount','0','source_discount_amount','0','supply_type','STANDARD','net_amount',base_net::text,'source_net_amount',net::text,
   'tax_rate','15','tax_amount',base_tax::text,'source_tax_amount',vat::text,'gross_amount',(base_net+base_tax)::text,'source_gross_amount',gross::text)),
   'QA_ONLY: synthetic invoice, not submitted to ZATCA');
  result:=to_jsonb(public.create_financial_event_command(jsonb_build_object('organization_id',org,'entity_id',entity,'counterparty_id',party,
   'event_type','REVENUE','source_module','OPERATIONAL_CONSOLE','source_record_id',doc,'source_event_key','vat_documents:'||doc,
   'event_date',current_date,'due_date',current_date+14,'base_currency','SAR','description','Sales invoice '||label,
   'lines',jsonb_build_array(
    jsonb_build_object('line_number',1,'description','QA sales revenue','classification_id',rev,'cost_center_id',null,'amount',base_net,'currency','SAR','exchange_rate',1,'base_amount',base_net,'cash_direction','NON_CASH','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0),
    jsonb_build_object('line_number',2,'description','QA output VAT','classification_id',tax,'cost_center_id',null,'amount',base_tax,'currency','SAR','exchange_rate',1,'base_amount',base_tax,'cash_direction','NON_CASH','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0)),
   'obligations',jsonb_build_array(jsonb_build_object('obligation_key','invoice-gross','obligation_type','RECEIVABLE','settleable_amount',base_net+base_tax,'currency','SAR','exchange_rate',1,'base_currency','SAR','settleable_base_amount',base_net+base_tax)),
   'links',jsonb_build_array(jsonb_build_object('link_type','SOURCE','target_module','vat_documents','target_record_id',doc,'metadata',jsonb_build_object('document_type','SALES'))))));
  event:=coalesce(result->>'event_id',result->>'id',trim(both '"' from result::text))::uuid;
  perform public.transition_financial_event(event,'PLANNED','QA invoice preparation');
  perform public.transition_financial_event(event,'COMMITTED','QA invoice pending approval');
  select id into obligation from public.financial_event_obligations where event_id=event and obligation_type='RECEIVABLE';
  insert into public.liquidity_flows(id,organization_id,direction,flow_type,title,due_date,amount,currency,base_amount,status,source,source_module,source_record_id,source_event_key,counterparty_id,counterparty,reference,notes)
  values(flow,org,'INFLOW','OPERATING','Invoice receivable · '||label,current_date+14,base_net+base_tax,'SAR',base_net+base_tax,'EXPECTED','INVOICE','VAT_INTEGRATION',doc,'vat_documents:'||doc||':cash-forecast',party,'عميل تجريبي — غير حقيقي',label,'QA_ONLY');
  insert into public.financial_event_links(event_id,organization_id,link_type,target_module,target_record_id) values(event,org,'CASH_FLOW','liquidity_flows',flow);
  insert into public.vat_einvoices(id,organization_id,created_by,invoice_number,document_type,invoice_category,issue_date,issue_time,due_date,currency,exchange_rate,
   seller_name,seller_vat_number,seller_address,seller_building_number,seller_district,seller_additional_number,seller_city,seller_postal_code,
   buyer_contact_id,buyer_name,buyer_vat_number,buyer_address,buyer_building_number,buyer_district,buyer_additional_number,buyer_city,buyer_postal_code,buyer_country_code,
   line_extension_amount,tax_exclusive_amount,tax_total_amount,tax_inclusive_amount,payable_amount,tax_total_amount_sar,accounting_document_id)
  values(invoice,org,u,label,'INVOICE',case n when 1 then 'SIMPLIFIED' else 'STANDARD' end,current_date,'10:00:00',current_date+14,curr,rate,
   'شركة تجريبية لمراجعة الفواتير','303123456789013','شارع الاختبار','1001','حي الاختبار','2002','الرياض','12345',
   contact,'عميل تجريبي — غير حقيقي','303987654321013','شارع تجريبي','3003','حي التجربة','4004','الرياض','12345','SA',
   net,net,vat,gross,gross,base_tax,doc);
  insert into public.vat_einvoice_lines(invoice_id,line_number,item_name,quantity,unit_code,unit_price,discount_amount,tax_category,tax_rate,line_extension_amount,tax_amount,gross_amount)
  values(invoice,1,'خدمة اختبار '||n,1,'PCE',net,0,'S',15,net,vat,gross);

  if n in (2,3,4) then
   perform public.approve_financial_event(event,'QA owner-controlled recognition');
   perform public.transition_financial_event(event,'ACTUAL','QA recognition without cash');
   amount:=case n when 2 then 500 when 3 then 3450 else 600 end;
   result:=to_jsonb(public.create_financial_event_command(jsonb_build_object('organization_id',org,'entity_id',entity,'counterparty_id',party,
    'event_type','SETTLEMENT','source_module','OPERATIONAL_CONSOLE','source_record_id',flow,'source_event_key','qa_receipt:'||flow,
    'event_date',current_date,'due_date',null,'base_currency','SAR','description','QA receipt for '||label,
    'lines',jsonb_build_array(jsonb_build_object('line_number',1,'description','QA invoice receipt','classification_id',ar,'cost_center_id',null,'amount',amount,'currency','SAR','exchange_rate',1,'base_amount',amount,'cash_direction','INFLOW','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0)),
    'obligations','[]'::jsonb,'links',jsonb_build_array(
     jsonb_build_object('link_type','SETTLEMENT_OF','related_event_id',event,'metadata','{}'::jsonb),
     jsonb_build_object('link_type','OTHER','target_module','liquidity_flows','target_record_id',flow,'metadata',jsonb_build_object('purpose','SETTLEMENT_INSTRUCTION','account_id',bank,'direction','INFLOW','settlement_date',current_date,'amount',amount,'base_amount',amount,'flow_amount',amount,'currency','SAR','exchange_rate',1,'obligation_id',obligation))))));
   receipt:=coalesce(result->>'event_id',result->>'id',trim(both '"' from result::text))::uuid;
   perform public.transition_financial_event(receipt,'PLANNED','QA receipt');
   perform public.transition_financial_event(receipt,'COMMITTED','QA receipt saved');
   if n in(2,3) then
    perform public.approve_financial_event(receipt,'QA owner-controlled receipt approval');
    perform public.post_financial_settlement(receipt,bank,'INFLOW',current_date,amount,'SAR',1,amount,
     jsonb_build_array(jsonb_build_object('obligation_id',obligation,'flow_id',flow,'amount',amount,'base_amount',amount,'flow_amount',amount,'flow_currency','SAR','flow_exchange_rate',1)));
   end if;
  end if;
 end loop;
 perform set_config('qa.review_org',org::text,true);
 if (select current_balance from public.liquidity_accounts where id=bank)<>3950 then raise exception 'QA_BANK_TOTAL_FAILED'; end if;
 if (select sum(f.amount-f.settled_amount) from public.liquidity_flows f where f.organization_id=org)<>9706.25 then raise exception 'QA_OUTSTANDING_TOTAL_FAILED'; end if;
end $seed$;
set local role authenticated;
do $verify$
declare org uuid:=current_setting('qa.review_org')::uuid; e public.vat_einvoices%rowtype; h jsonb; l jsonb; event uuid; bank uuid;
begin
 if (select count(*) from public.vat_einvoices where organization_id=org)<>5 then raise exception 'QA_MEMBER_INVOICE_VISIBILITY_FAILED'; end if;
 -- Test the app's invoker-security amendments under the actual member role, then roll back only the probes.
 begin
  select * into e from public.vat_einvoices where organization_id=org and invoice_number='QA-INV-001';
  h:=to_jsonb(e)||jsonb_build_object('line_extension_amount',1200,'tax_exclusive_amount',1200,'tax_total_amount',180,'tax_total_amount_sar',180,'tax_inclusive_amount',1380,'payable_amount',1380);
  l:='[{"line_number":1,"item_name":"خدمة اختبار 1","quantity":1,"unit_code":"PCE","unit_price":1200,"discount_amount":0,"tax_category":"S","tax_rate":15,"line_extension_amount":1200,"tax_amount":180,"gross_amount":1380}]';
  perform public.amend_zatca_draft_atomic(e.id,h,l);
  if not exists(select 1 from public.liquidity_flows where organization_id=org and source_record_id=e.accounting_document_id and amount=1380) then raise exception 'QA_DRAFT_FLOW_AMEND_FAILED'; end if;
  select id into event from public.financial_events where organization_id=org and event_type='SETTLEMENT' and status='COMMITTED';
  select id into bank from public.liquidity_accounts where organization_id=org and name='بنك تجريبي — حساب القبض';
  perform public.amend_pending_invoice_receipt(event,bank,current_date,700);
  if (select amount from public.financial_event_lines where event_id=event)<>700 or (select current_balance from public.liquidity_accounts where id=bank)<>3950 then raise exception 'QA_PENDING_RECEIPT_AMEND_FAILED'; end if;
  raise exception 'QA_PROBE_ROLLBACK';
 exception when raise_exception then if sqlerrm<>'QA_PROBE_ROLLBACK' then raise; end if; end;
end $verify$;
commit;
