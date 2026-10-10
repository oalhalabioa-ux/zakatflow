create temporary table asset_lifecycle_test_results(test text,passed boolean);grant select,insert on asset_lifecycle_test_results to authenticated;
do $$
declare uid uuid;org uuid;p jsonb;a jsonb;c jsonb;eid uuid;balance numeric;q numeric;sid uuid;dep_id uuid;stale_id uuid;request uuid;retry jsonb;failed boolean:=false;
begin
 select m.user_id,m.organization_id into uid,org from public.organization_members m join public.profiles p on p.id=m.user_id join public.organizations o on o.id=m.organization_id where m.status='ACTIVE' and m.role in('OWNER','ADMIN') and o.base_currency='SAR' limit 1;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 insert into public.financial_classifications(organization_id,code,name,classification_type,created_by) values(org,'QA_DEP_'||left(gen_random_uuid()::text,8),'QA depreciation','OPEX',uid);
 insert into public.liquidity_counterparties(organization_id,name,party_type,created_by) values(org,'QA asset sale customer','CUSTOMER',uid) returning id into sid;
 insert into public.financial_classifications(organization_id,code,name,classification_type,created_by) values(org,'QA_REV_'||left(sid::text,8),'QA gain','REVENUE',uid),(org,'QA_ASSET_'||left(sid::text,8),'QA carrying','ASSET',uid),(org,'QA_TAX_'||left(sid::text,8),'QA sale tax','TAX',uid);
 set local role authenticated;
 p:=jsonb_build_object('name','QA lifecycle machine','asset_type','OTHER','asset_class_code','PPE','asset_type_code','MACHINERY','currency','SAR','ownership_scope','ORGANIZATION','organization_id',org,'metadata',jsonb_build_object('quantity',2,'purchase_value',1000,'purchase_date','2026-01-01','acquisition_mode','OPENING_BALANCE'));
 a:=public.create_asset_with_acquisition(p,gen_random_uuid());
 c:=public.prepare_asset_lifecycle((a->>'id')::uuid,jsonb_build_object('operation','DEPRECIATION','date','2026-02-01','amount',100),gen_random_uuid());eid:=(c->>'financial_event_id')::uuid;
 select sum(remaining_value_base) into balance from public.lots where asset_account_id=(a->>'id')::uuid;
 insert into asset_lifecycle_test_results values('draft_depreciation_does_not_change_book_value',balance=1000);
 perform public.transition_financial_event(eid,'PLANNED','QA');perform public.transition_financial_event(eid,'COMMITTED','QA');perform public.approve_financial_event(eid,'QA');perform public.transition_financial_event(eid,'ACTUAL','QA');
 select sum(remaining_value_base),sum(remaining_quantity) into balance,q from public.lots where asset_account_id=(a->>'id')::uuid;
 insert into asset_lifecycle_test_results values('approved_depreciation_changes_value_not_quantity',balance=900 and q=2);dep_id:=eid;
 failed:=false;begin perform public.prepare_asset_lifecycle((a->>'id')::uuid,jsonb_build_object('operation','DEPRECIATION','date','2026-02-20','amount',10),gen_random_uuid());exception when others then failed:=sqlerrm='ASSET_DEPRECIATION_PERIOD_EXISTS';end;
 insert into asset_lifecycle_test_results values('duplicate_month_depreciation_rejected',failed);
 c:=public.prepare_asset_lifecycle((a->>'id')::uuid,jsonb_build_object('operation','DISPOSAL','date','2026-04-01','quantity',1,'amount',0),gen_random_uuid());stale_id:=(c->>'financial_event_id')::uuid;

 c:=public.prepare_asset_lifecycle((a->>'id')::uuid,jsonb_build_object('operation','DISPOSAL','date','2026-03-01','quantity',1,'amount',0),gen_random_uuid());eid:=(c->>'financial_event_id')::uuid;
 perform public.transition_financial_event(eid,'PLANNED','QA');perform public.transition_financial_event(eid,'COMMITTED','QA');perform public.approve_financial_event(eid,'QA');perform public.transition_financial_event(eid,'ACTUAL','QA');
 select sum(remaining_value_base),sum(remaining_quantity) into balance,q from public.lots where asset_account_id=(a->>'id')::uuid;
 insert into asset_lifecycle_test_results values('approved_disposal_releases_proportional_book_value',balance=450 and q=1);
 begin perform public.prepare_asset_lifecycle((a->>'id')::uuid,jsonb_build_object('operation','DISPOSAL','date','2026-04-01','quantity',2,'amount',0),gen_random_uuid());exception when others then failed:=sqlerrm='ASSET_QUANTITY_INVALID';end;
 insert into asset_lifecycle_test_results values('cannot_dispose_more_than_held',failed);

 perform public.transition_financial_event(stale_id,'PLANNED','QA');perform public.transition_financial_event(stale_id,'COMMITTED','QA');perform public.approve_financial_event(stale_id,'QA');failed:=false;
 begin perform public.transition_financial_event(stale_id,'ACTUAL','QA');exception when others then failed:=sqlerrm='ASSET_OPERATION_BALANCE_CHANGED_RECREATE';end;
 insert into asset_lifecycle_test_results values('stale_draft_cannot_mutate_changed_asset',failed);
 request:=gen_random_uuid();p:=jsonb_build_object('operation','SALE','date','2026-05-01','quantity',1,'amount',600,'vat_amount',90,'counterparty_id',sid,'due_date','2026-06-01');
 c:=public.prepare_asset_lifecycle((a->>'id')::uuid,p,request);eid:=(c->>'financial_event_id')::uuid;retry:=public.prepare_asset_lifecycle((a->>'id')::uuid,p,request);
 insert into asset_lifecycle_test_results values('sale_retry_keeps_same_event',retry->>'financial_event_id'=eid::text);
 insert into asset_lifecycle_test_results values('sale_obligation_includes_output_vat',(select settleable_amount=690 from public.financial_event_obligations where event_id=eid));
 insert into asset_lifecycle_test_results values('sale_forecast_is_uncollected',(select amount=690 and direction='INFLOW' and status='EXPECTED' and settled_amount=0 from public.liquidity_flows where source_event_key='asset-event:'||eid||':cash-forecast'));
 select sum(remaining_quantity) into q from public.lots where asset_account_id=(a->>'id')::uuid;insert into asset_lifecycle_test_results values('sale_draft_does_not_reduce_quantity',q=1);
 perform public.transition_financial_event(eid,'PLANNED','QA');perform public.transition_financial_event(eid,'COMMITTED','QA');perform public.approve_financial_event(eid,'QA');perform public.transition_financial_event(eid,'ACTUAL','QA');
 select sum(remaining_value_base),sum(remaining_quantity) into balance,q from public.lots where asset_account_id=(a->>'id')::uuid;
 insert into asset_lifecycle_test_results values('actual_sale_removes_carried_value',balance=0 and q=0);
 insert into asset_lifecycle_test_results values('sale_records_gain_and_frozen_vat',exists(select 1 from public.transactions where metadata->>'financial_event_id'=eid::text and (metadata->>'realized_gain_base')::numeric=150 and (metadata->>'vat_amount')::numeric=90 and (metadata->>'cost_basis_base')::numeric=450));
end $$;
select * from asset_lifecycle_test_results;
do $$ begin if exists(select 1 from asset_lifecycle_test_results where not passed) then raise exception 'ASSET_LIFECYCLE_TEST_FAILED';end if;end $$;
