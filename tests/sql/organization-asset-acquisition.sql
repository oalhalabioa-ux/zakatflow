create temporary table org_asset_test_results(test text,passed boolean);grant select,insert on org_asset_test_results to authenticated;
do $$
declare uid uuid;org uuid;sid uuid;entity uuid;contact uuid;eid uuid;doc jsonb;a2 jsonb;event_count integer;doc_count integer;p jsonb;a jsonb;failed boolean:=false;before_count integer;balance numeric;
begin
 select m.user_id,m.organization_id into uid,org from public.organization_members m join public.profiles p on p.id=m.user_id join public.organizations o on o.id=m.organization_id where m.status='ACTIVE' and m.role in('OWNER','ADMIN') and o.base_currency='SAR' limit 1;
 if uid is null then raise exception 'QA_OWNER_REQUIRED';end if;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 insert into public.organization_entities(organization_id,name) values(org,'QA asset invoice entity') returning id into entity;
 insert into public.liquidity_counterparties(organization_id,name,party_type,created_by) values(org,'QA supplier atomic asset','SUPPLIER',uid) returning id into sid;
 insert into public.financial_classifications(organization_id,code,name,classification_type,created_by) values(org,'QA_CAPEX_'||left(sid::text,8),'QA asset cost','CAPEX',uid),(org,'QA_TAX_'||left(sid::text,8),'QA asset VAT','TAX',uid);
 insert into public.vat_contacts(organization_id,contact_type,name,created_by) values(org,'SUPPLIER','QA asset VAT supplier',uid) returning id into contact;
 set local role authenticated;
 p:=jsonb_build_object('name','QA company asset','asset_type','OTHER','asset_class_code','PPE','asset_type_code','MACHINERY','currency','USD','ownership_scope','ORGANIZATION','organization_id',org,'entity_id',entity,'metadata',jsonb_build_object('quantity',2,'purchase_value',100,'purchase_date','2026-02-01','acquisition_mode','PURCHASE','fx_rate',3.75,'vat_amount',15,'recoverable_percent',50,'counterparty_id',sid,'invoice_reference','QA-INV-ATOMIC','due_date','2026-03-01'));
 a:=public.create_asset_with_acquisition(p,gen_random_uuid());eid:=(a->>'financial_event_id')::uuid;
 select sum(remaining_value_base) into balance from public.lots where asset_account_id=(a->>'id')::uuid;
 insert into org_asset_test_results values('org_cost_capitalizes_nonrecoverable_vat_and_fx',balance=403.125);
 select sum(settleable_base_amount) into balance from public.financial_event_obligations where event_id=eid;
 insert into org_asset_test_results values('org_supplier_payable_is_gross_with_fx',balance=431.25);
 insert into org_asset_test_results values('org_purchase_preserves_due_date',(select due_date='2026-03-01'::date from public.financial_events where id=eid));
 insert into org_asset_test_results values('org_purchase_does_not_claim_actual',(select status='DRAFT' from public.financial_events where id=eid));

 insert into org_asset_test_results values('purchase_is_pending_until_actual',(select (metadata->>'recognition_pending')::boolean from public.lots where asset_account_id=(a->>'id')::uuid limit 1));
 insert into org_asset_test_results values('forecast_is_gross_and_expected',(select amount=115 and base_amount=431.25 and currency='USD' and status='EXPECTED' and due_date='2026-03-01'::date and settled_amount=0 from public.liquidity_flows where source_event_key='asset-event:'||eid||':cash-forecast'));
 select count(*) into event_count from public.financial_events where organization_id=org;
 doc:=public.create_asset_vat_document(jsonb_build_object('organization_id',org,'document_type','PURCHASE','document_kind','INVOICE','document_number','QA-ASSET-'||left(eid::text,8),'transaction_date','2026-02-01','due_date','2026-03-01','counterparty_contact_id',contact,'counterparty_name','QA asset VAT supplier','supply_type','STANDARD','net_amount',375,'tax_rate',15,'tax_amount',56.25,'gross_amount',431.25,'recoverable_percent',50,'currency','SAR','source_currency','USD','exchange_rate',3.75,'source_net_amount',100,'source_tax_amount',15,'source_gross_amount',115,'line_items','[]'::jsonb,'asset_transaction_id',a->>'acquisition_transaction_id'));
 insert into org_asset_test_results values('VAT_alias_reuses_core_event',doc#>>'{financial_core,event_id}'=eid::text and event_count=(select count(*) from public.financial_events where organization_id=org));
 insert into org_asset_test_results values('VAT_alias_has_source_link',exists(select 1 from public.financial_event_links where event_id=eid and target_module='vat_documents' and link_type='SOURCE' and target_record_id=(doc->>'id')::uuid));
 a2:=public.create_asset_with_acquisition(p,gen_random_uuid());
 select count(*) into doc_count from public.vat_documents where organization_id=org;failed:=false;
 begin perform public.create_asset_vat_document((doc-'id'-'financial_core')||jsonb_build_object('document_number','QA-BAD-'||left(eid::text,8),'source_net_amount',99,'asset_transaction_id',a2->>'acquisition_transaction_id'));exception when others then failed:=sqlerrm='ASSET_VAT_MUST_MATCH_FROZEN_ACQUISITION';end;
 insert into org_asset_test_results values('mismatched_vat_rolls_back_invoice',failed and doc_count=(select count(*) from public.vat_documents where organization_id=org));
 perform public.transition_financial_event(eid,'PLANNED','QA');perform public.transition_financial_event(eid,'COMMITTED','QA');perform public.approve_financial_event(eid,'QA');perform public.transition_financial_event(eid,'ACTUAL','QA');
 insert into org_asset_test_results values('actual_purchase_releases_pending_flag',(select not (metadata->>'recognition_pending')::boolean from public.lots where asset_account_id=(a->>'id')::uuid limit 1));
 select count(*) into before_count from public.asset_accounts where organization_id=org;
 begin perform public.create_asset_with_acquisition(jsonb_set(p,'{metadata,counterparty_id}','null'),gen_random_uuid());exception when others then failed:=sqlerrm='ASSET_SUPPLIER_INVOICE_DUE_REQUIRED';end;
 insert into org_asset_test_results values('missing_supplier_rolls_back_everything',failed and before_count=(select count(*) from public.asset_accounts where organization_id=org));
end $$;
select * from org_asset_test_results;
do $$ begin if exists(select 1 from org_asset_test_results where not passed) then raise exception 'ORG_ASSET_TEST_FAILED';end if;end $$;
