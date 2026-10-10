-- QA only, enclosed in BEGIN / ROLLBACK by the runner.
create temporary table asset_control_results(test text,passed boolean);
grant all on asset_control_results to authenticated;
do $$
declare uid uuid;aid uuid;tid uuid;linked_tid uuid;cid uuid;mid uuid;lid1 uuid;lid2 uuid;assessment jsonb;payment uuid;err text;payload jsonb;line_items jsonb;
begin
 select id into uid from public.profiles where base_currency='SAR' limit 1;
 select id into mid from public.zakat_methods where code='INDEPENDENT_LOTS' limit 1;
 perform set_config('request.jwt.claim.sub',uid::text,true);set local role authenticated;
 insert into public.asset_accounts(user_id,asset_type,name,currency,unit,metadata) values(uid,'GOLD','QA delete and FIFO','SAR','g','{}') returning id into aid;
 insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value) values(uid,aid,'ADD','2025-01-01',0,'SAR',0,'SAR',0) returning id into tid;
 insert into asset_control_results select 'unlinked_delete_available',can_delete from public.asset_transaction_delete_eligibility(array[tid]);
 perform public.delete_unlinked_asset_transaction(tid);
 insert into asset_control_results select 'delete_removes_only_unlinked',exists(select 1 from public.transactions where id=tid and metadata->>'asset_deleted'='true');
 insert into asset_control_results select 'deleted_record_kept_in_audit',exists(select 1 from public.audit_logs where entity_id=tid and action='DELETE_UNLINKED' and old_data->>'asset_account_id'=aid::text);
 perform public.restore_unlinked_asset_transaction(tid);
 insert into asset_control_results select 'deleted_operation_can_be_restored',exists(select 1 from public.transactions where id=tid and not(metadata ? 'asset_deleted'));
 insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value) values(uid,aid,'OPENING_BALANCE','2025-01-01',200,'SAR',8000,'SAR',8000) returning id into linked_tid;
 insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base) values(uid,aid,linked_tid,'2025-01-01','2025-01-01',100,100,4000,4000) returning id into lid1;
 insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base) values(uid,aid,linked_tid,'2025-03-01','2025-03-01',100,100,4000,4000) returning id into lid2;
 begin perform public.delete_unlinked_asset_transaction(linked_tid);raise exception 'EXPECTED_BLOCK';exception when others then if sqlerrm not like 'TRANSACTION_DELETE_LINKED:%' then raise;end if;end;
 insert into asset_control_results select 'linked_delete_blocked',exists(select 1 from public.transactions where id=linked_tid);
 insert into public.zakat_hawl_cycles(user_id,cycle_no,nisab_standard,nisab_value_base,nisab_reached_date,hawl_start_date,hawl_due_date,status) values(uid,(select coalesce(max(cycle_no),0)+20000 from public.zakat_hawl_cycles where user_id=uid),'GOLD',3400,'2025-01-01','2025-01-01','2026-01-01','ACTIVE') returning id into cid;
 payload:=jsonb_build_object('assessment_date','2026-10-10','valuation_date','2026-10-10','method_id',mid,'nisab_standard','GOLD','nisab_quantity',85,'nisab_value_base',3400,'total_zakatable_value',8000,'zakat_rate',0.025,'zakat_due',200,'currency','SAR','hawl_cycle_id',cid,'calculation_snapshot',jsonb_build_object('schemaVersion',2,'candidateLots',2,'priceMode','MANUAL','priceSource','USER_MANUAL','calendarType','HIJRI_TABULAR','prices',jsonb_build_object('gold',40,'silver',4),'metalPrices',jsonb_build_object('GOLD',jsonb_build_object('price',40,'fxRate',1))));
 select jsonb_agg(jsonb_build_object('lot_id',l.id,'quantity',100,'valuation_price',40,'valuation_currency','SAR','fx_rate',1,'market_value',4000,'eligible_value',4000,'zakat_amount',100,'eligibility_status','ELIGIBLE','reason_code','ELIGIBLE','explanation','QA FIFO','valuation_snapshot',jsonb_build_object('purity',1,'hawlDueDate',case when l.id=lid1 then '2026-01-01' else '2026-03-01' end))) into line_items from public.lots l where id in(lid1,lid2);
 assessment:=public.save_zakat_assessment_snapshot(payload,line_items,null);
 insert into public.zakat_payments(user_id,assessment_id,hawl_cycle_id,payment_date,amount,currency,base_amount) values(uid,(assessment->>'id')::uuid,cid,'2026-10-10',150,'SAR',150) returning id into payment;
 perform public.allocate_zakat_payment_fifo(payment);
 insert into asset_control_results select 'older_due_paid_before_newer',coalesce((select sum(allocated_amount) from public.zakat_payment_allocations where payment_id=payment and lot_id=lid1),0)=100 and coalesce((select sum(allocated_amount) from public.zakat_payment_allocations where payment_id=payment and lot_id=lid2),0)=50;
 perform public.allocate_zakat_payment_fifo(payment);
 insert into asset_control_results select 'fifo_retry_no_duplicate', (select sum(allocated_amount)=150 from public.zakat_payment_allocations where payment_id=payment);
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin perform public.delete_unlinked_asset_transaction(linked_tid);raise exception 'EXPECTED_OWNER_BLOCK';exception when others then if sqlerrm<>'TRANSACTION_NOT_FOUND' then raise;end if;end;
 insert into asset_control_results values('other_user_delete_blocked',true);
end $$;
reset role;
select * from asset_control_results;
do $$ begin if exists(select 1 from asset_control_results where not passed) then raise exception 'ASSET_CONTROL_TEST_FAILED';end if;end $$;
