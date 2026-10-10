-- QA only, enclosed in BEGIN / ROLLBACK by the runner.
create temporary table asset_control_results(test text,passed boolean);
grant all on asset_control_results to authenticated;
do $$
declare uid uuid;aid uuid;tid uuid;linked_tid uuid;cid uuid;mid uuid;lid1 uuid;lid2 uuid;assessment jsonb;payment uuid;payment2 uuid;payment3 uuid;cid2 uuid;assessment2 jsonb;allocation_ids jsonb;err text;payload jsonb;line_items jsonb;final_before jsonb;cid3 uuid;lid3 uuid;zero_line uuid;payment4 uuid;
begin
 uid:=gen_random_uuid();insert into auth.users(id,email,aud,role) values(uid,'final-fifo-'||uid||'@example.invalid','authenticated','authenticated');insert into public.profiles(id,base_currency) values(uid,'SAR') on conflict(id) do nothing;
 select id into mid from public.zakat_methods where code='INDEPENDENT_LOTS' limit 1;
 perform set_config('request.jwt.claim.sub',uid::text,true);set local role authenticated;
 insert into public.asset_accounts(user_id,asset_type,name,currency,unit,metadata) values(uid,'GOLD','QA delete and FIFO','SAR','g','{}') returning id into aid;
 insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value) values(uid,aid,'ADD','2022-01-01',0,'SAR',0,'SAR',0) returning id into tid;
 insert into asset_control_results select 'unlinked_delete_available',can_delete from public.asset_transaction_delete_eligibility(array[tid]);
 perform public.delete_unlinked_asset_transaction(tid);
 insert into asset_control_results select 'delete_removes_only_unlinked',exists(select 1 from public.transactions where id=tid and metadata->>'asset_deleted'='true');
 insert into asset_control_results select 'deleted_record_kept_in_audit',exists(select 1 from public.audit_logs where entity_id=tid and action='DELETE_UNLINKED' and old_data->>'asset_account_id'=aid::text);
 perform public.restore_unlinked_asset_transaction(tid);
 insert into asset_control_results select 'deleted_operation_can_be_restored',exists(select 1 from public.transactions where id=tid and not(metadata ? 'asset_deleted'));
 insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value) values(uid,aid,'OPENING_BALANCE','2022-01-01',200,'SAR',8000,'SAR',8000) returning id into linked_tid;
 insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base) values(uid,aid,linked_tid,'2022-01-01','2022-01-01',100,100,4000,4000) returning id into lid1;
 insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base) values(uid,aid,linked_tid,'2022-03-01','2022-03-01',100,100,4000,4000) returning id into lid2;
 begin perform public.delete_unlinked_asset_transaction(linked_tid);raise exception 'EXPECTED_BLOCK';exception when others then if sqlerrm not like 'TRANSACTION_DELETE_LINKED:%' then raise;end if;end;
 insert into asset_control_results select 'linked_delete_blocked',exists(select 1 from public.transactions where id=linked_tid);
 insert into public.zakat_hawl_cycles(user_id,cycle_no,nisab_standard,nisab_value_base,nisab_reached_date,hawl_start_date,hawl_due_date,status) values(uid,(select coalesce(max(cycle_no),0)+20000 from public.zakat_hawl_cycles where user_id=uid),'GOLD',3400,'2022-01-01','2022-01-01','2023-01-01','ACTIVE') returning id into cid;
 payload:=jsonb_build_object('assessment_date','2023-10-10','valuation_date','2023-10-10','method_id',mid,'nisab_standard','GOLD','nisab_quantity',85,'nisab_value_base',3400,'total_zakatable_value',8000,'zakat_rate',0.025,'zakat_due',200,'currency','SAR','hawl_cycle_id',cid,'calculation_snapshot',jsonb_build_object('schemaVersion',2,'hawlPeriodPolicy','FINAL_COVERAGE_V1','candidateLots',2,'priceMode','MANUAL','priceSource','USER_MANUAL','calendarType','HIJRI_TABULAR','prices',jsonb_build_object('gold',40,'silver',4),'metalPrices',jsonb_build_object('GOLD',jsonb_build_object('price',40,'fxRate',1))));
 select jsonb_agg(jsonb_build_object('lot_id',l.id,'quantity',100,'valuation_price',40,'valuation_currency','SAR','fx_rate',1,'market_value',4000,'eligible_value',4000,'zakat_amount',100,'eligibility_status','ELIGIBLE','reason_code','ELIGIBLE','explanation','QA FIFO','valuation_snapshot',jsonb_build_object('purity',1,'hawlStartDate',l.hawl_start_date,'hawlDueDate',public.zakat_next_hawl_date(l.hawl_start_date,'HIJRI'),'hawlPeriod',1))) into line_items from public.lots l where id in(lid1,lid2);
 assessment:=public.save_zakat_assessment_snapshot(payload,line_items,null);
 select to_jsonb(a) into final_before from public.zakat_assessments a where a.id=(assessment->>'id')::uuid;
 perform public.close_zakat_cycle(cid,(assessment->>'id')::uuid);
 final_before:=final_before||jsonb_build_object('assessment_kind','FINAL');
 perform public.correct_final_zakat_cycle_dates(cid,'2022-03-15');
 insert into asset_control_results select 'date_correction_preserves_frozen_assessment',final_before=(select to_jsonb(a) from public.zakat_assessments a where a.id=(assessment->>'id')::uuid) and (select hawl_start_date='2022-03-15' and hawl_due_date='2023-10-10' from public.zakat_hawl_cycles where id=cid);
 begin update public.zakat_hawl_cycles set hawl_start_date='2022-03-16' where id=cid;raise exception 'EXPECTED_DATE_LOCK';exception when others then if sqlerrm<>'CLOSED_CYCLE_ASSESSMENT_LOCKED' then raise;end if;end;
 insert into asset_control_results values('direct_final_date_edit_remains_locked',true);

 insert into public.zakat_payments(user_id,assessment_id,hawl_cycle_id,payment_date,amount,currency,base_amount) values(uid,(assessment->>'id')::uuid,cid,'2023-10-10',150,'SAR',150) returning id into payment;
 perform public.allocate_zakat_payment_fifo(payment);
 insert into asset_control_results select 'older_due_paid_before_newer',coalesce((select sum(allocated_amount) from public.zakat_payment_allocations where payment_id=payment and lot_id=lid1),0)=100 and coalesce((select sum(allocated_amount) from public.zakat_payment_allocations where payment_id=payment and lot_id=lid2),0)=50;
 -- Deliberately corrupt allocation distribution in this rolled-back QA fixture.
 update public.zakat_payment_allocations set allocated_amount=case when lot_id=lid1 then 20 else 130 end where payment_id=payment;
 perform public.reconcile_final_zakat_payments();
 insert into asset_control_results select 'overcapacity_repair_preserves_payment', (select base_amount=150 from public.zakat_payments where id=payment) and (select sum(allocated_amount)=150 from public.zakat_payment_allocations where payment_id=payment) and not exists(select 1 from public.zakat_payment_allocations pa join public.zakat_assessment_lines al on al.id=pa.assessment_line_id where pa.user_id=uid group by al.id,al.zakat_amount having sum(pa.allocated_amount)>al.zakat_amount);
 insert into asset_control_results select 'repair_is_audited',exists(select 1 from public.audit_logs where user_id=uid and action='REPAIR_INVALID_FINAL_LINE_CAPACITY');
 select jsonb_agg(id order by id) into allocation_ids from public.zakat_payment_allocations where payment_id=payment;
 perform public.allocate_zakat_payment_fifo(payment);
 insert into asset_control_results select 'retry_preserves_existing_allocation_ids',allocation_ids=(select jsonb_agg(id order by id) from public.zakat_payment_allocations where payment_id=payment);
 insert into asset_control_results select 'fifo_retry_no_duplicate', (select sum(allocated_amount)=150 from public.zakat_payment_allocations where payment_id=payment);

 -- Excess first settles cycle 1; no credit is consumed by a preview.
 payment2:=(public.write_zakat_payment(jsonb_build_object('hawl_cycle_id',cid,'payment_date','2023-10-11','amount',100,'base_amount',100,'currency','SAR'))->>'id')::uuid;
 insert into asset_control_results select 'final_due_capped_and_paid', (select sum(allocated_amount)=200 from public.zakat_payment_allocations where hawl_cycle_id=cid) and (select status='PAID' from public.zakat_hawl_cycles where id=cid);
 insert into asset_control_results select 'excess_credit_50', (select base_amount-coalesce((select sum(allocated_amount) from public.zakat_payment_allocations where payment_id=payment2),0)=50 from public.zakat_payments where id=payment2);
 insert into public.zakat_hawl_cycles(user_id,cycle_no,nisab_standard,nisab_value_base,nisab_reached_date,hawl_start_date,hawl_due_date,status) values(uid,20001,'GOLD',3400,'2023-10-11','2023-10-11',public.zakat_next_hawl_date('2023-10-11','HIJRI'),'ACTIVE') returning id into cid2;
 payload:=payload||jsonb_build_object('hawl_cycle_id',cid2,'assessment_date','2024-10-10','valuation_date','2024-10-10');
 select jsonb_agg(item||jsonb_build_object('valuation_snapshot',item->'valuation_snapshot'||jsonb_build_object('hawlStartDate',p.hawl_start_date,'hawlDueDate',p.hawl_due_date,'hawlPeriod',p.hawl_period))) into line_items from jsonb_array_elements(line_items) item join public.zakat_lot_hawl_periods('HIJRI') p on p.lot_id=(item->>'lot_id')::uuid;
 assessment2:=public.save_zakat_assessment_snapshot(payload,line_items,null);
 begin perform public.write_zakat_payment(jsonb_build_object('hawl_cycle_id',cid2,'payment_date','2023-10-11','amount',10,'base_amount',10,'currency','SAR'));raise exception 'EXPECTED_FINAL_BLOCK';exception when others then if sqlerrm<>'CYCLE_NOT_FINALIZED' then raise;end if;end;
 insert into asset_control_results values('nonfinal_cycle_payment_reference_blocked',true);
 perform public.reconcile_final_zakat_payments();
 insert into asset_control_results select 'preview_does_not_consume_credit',not exists(select 1 from public.zakat_payment_allocations where hawl_cycle_id=cid2);
 -- A final snapshot cannot be replaced by another cycle's repeated annual period.
 begin perform public.save_zakat_assessment_snapshot(payload,(select jsonb_agg(item||jsonb_build_object('valuation_snapshot',item->'valuation_snapshot'||jsonb_build_object('hawlPeriod',1))) from jsonb_array_elements(line_items) item),null);raise exception 'EXPECTED_PERIOD_BLOCK';exception when others then if sqlerrm<>'ASSESSMENT_HAWL_PERIOD_MISMATCH' then raise;end if;end;
 insert into asset_control_results values('repeated_final_lot_period_blocked',true);
 perform public.close_zakat_cycle(cid2,(assessment2->>'id')::uuid);
 insert into asset_control_results select 'finalization_applies_credit_50', (select coalesce(sum(allocated_amount),0)=50 from public.zakat_payment_allocations where hawl_cycle_id=cid2 and payment_id=payment2);
 perform public.reconcile_final_zakat_payments();
 insert into asset_control_results select 'credit_retry_once',(select sum(allocated_amount)=250 from public.zakat_payment_allocations where user_id=uid);
 payment3:=(public.write_zakat_payment(jsonb_build_object('hawl_cycle_id',cid2,'payment_date','2023-10-12','amount',250,'base_amount',250,'currency','SAR'))->>'id')::uuid;
 insert into asset_control_results select 'second_final_cycle_paid_and_excess_100',(select sum(allocated_amount)=400 from public.zakat_payment_allocations where user_id=uid) and (select status='PAID' from public.zakat_hawl_cycles where id=cid2);
 -- Editing an earlier payment reflows all later payments atomically.
 perform public.write_zakat_payment(jsonb_build_object('hawl_cycle_id',cid,'payment_date','2023-10-11','amount',20,'base_amount',20,'currency','SAR'),payment2);
 insert into asset_control_results select 'edit_prior_payment_keeps_oldest_first',(select sum(allocated_amount)=200 from public.zakat_payment_allocations where hawl_cycle_id=cid) and (select sum(allocated_amount)=30 from public.zakat_payment_allocations where payment_id=payment3 and hawl_cycle_id=cid);
 perform public.write_zakat_payment('{}',payment3,true);
 insert into asset_control_results select 'delete_reopens_balance_and_removes_credit',(select status='CLOSED' from public.zakat_hawl_cycles where id=cid) and (select sum(allocated_amount)=170 from public.zakat_payment_allocations where hawl_cycle_id=cid) and not exists(select 1 from public.zakat_payment_allocations where hawl_cycle_id=cid2);

 -- Reproduce payment posted to a zero-liability, not-yet-mature lot.
 insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base) values(uid,aid,linked_tid,'2025-03-01','2025-03-01',100,100,4000,4000) returning id into lid3;
 insert into public.zakat_hawl_cycles(user_id,cycle_no,nisab_standard,nisab_value_base,nisab_reached_date,hawl_start_date,hawl_due_date,status) values(uid,20002,'GOLD',3400,'2024-10-11','2024-10-11',public.zakat_next_hawl_date('2024-10-11','HIJRI'),'ACTIVE') returning id into cid3;
 payload:=payload||jsonb_build_object('hawl_cycle_id',cid3,'assessment_date','2025-10-10','valuation_date','2025-10-10','calculation_snapshot',payload->'calculation_snapshot'||jsonb_build_object('candidateLots',3));
 select jsonb_agg(jsonb_build_object('lot_id',l.id,'quantity',100,'valuation_price',40,'valuation_currency','SAR','fx_rate',1,'market_value',4000,'eligible_value',case when l.id=lid3 then 0 else 4000 end,'zakat_amount',case when l.id=lid3 then 0 else 100 end,'eligibility_status',case when l.id=lid3 then 'HAWL_NOT_COMPLETED' else 'ELIGIBLE' end,'reason_code','QA','explanation','QA zero due','valuation_snapshot',jsonb_build_object('purity',1,'hawlStartDate',hp.hawl_start_date,'hawlDueDate',hp.hawl_due_date,'hawlPeriod',hp.hawl_period))) into line_items from public.lots l join public.zakat_lot_hawl_periods('HIJRI') hp on hp.lot_id=l.id where l.id in(lid1,lid2,lid3);
 assessment:=public.save_zakat_assessment_snapshot(payload,line_items,null);
 -- Early closure is rejected against the assessment date, independently of wall clock.
 update public.zakat_hawl_cycles set hawl_due_date='2025-10-11' where id=cid3;
 begin perform public.close_zakat_cycle(cid3,(assessment->>'id')::uuid);raise exception 'EXPECTED_EARLY_BLOCK';exception when others then if sqlerrm<>'CYCLE_HAWL_NOT_COMPLETED' then raise;end if;end;
 insert into asset_control_results values('early_cycle_finalization_blocked',true);
 update public.zakat_hawl_cycles set hawl_due_date=public.zakat_next_hawl_date(hawl_start_date,'HIJRI') where id=cid3;
 perform public.close_zakat_cycle(cid3,(assessment->>'id')::uuid);
 select id into zero_line from public.zakat_assessment_lines where assessment_id=(assessment->>'id')::uuid and lot_id=lid3;
 payment4:=(public.write_zakat_payment(jsonb_build_object('hawl_cycle_id',cid3,'payment_date','2025-10-12','amount',40,'base_amount',40,'currency','SAR'))->>'id')::uuid;
 update public.zakat_payment_allocations set allocated_amount=allocated_amount-5 where payment_id=payment4 and hawl_cycle_id=cid2;
 insert into public.zakat_payment_allocations(user_id,payment_id,hawl_cycle_id,assessment_id,assessment_line_id,lot_id,asset_account_id,due_date,allocated_amount) values(uid,payment4,cid3,(assessment->>'id')::uuid,zero_line,lid3,aid,'2026-02-19',5);
 perform public.reconcile_final_zakat_payments();
 insert into asset_control_results select 'zero_due_allocation_removed_and_payment_preserved',not exists(select 1 from public.zakat_payment_allocations where assessment_line_id=zero_line) and (select base_amount=40 from public.zakat_payments where id=payment4) and (select sum(allocated_amount)=40 from public.zakat_payment_allocations where payment_id=payment4);
 insert into asset_control_results select 'invalid_credit_returns_to_oldest_final_cycle',(select sum(allocated_amount)=30 from public.zakat_payment_allocations where payment_id=payment4 and hawl_cycle_id=cid) and (select sum(allocated_amount)=10 from public.zakat_payment_allocations where payment_id=payment4 and hawl_cycle_id=cid2) and not exists(select 1 from public.zakat_payment_allocations where payment_id=payment4 and hawl_cycle_id=cid3);
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin perform public.delete_unlinked_asset_transaction(linked_tid);raise exception 'EXPECTED_OWNER_BLOCK';exception when others then if sqlerrm<>'TRANSACTION_NOT_FOUND' then raise;end if;end;
 insert into asset_control_results values('other_user_delete_blocked',true);
 begin perform public.write_zakat_payment('{}',payment,true);raise exception 'EXPECTED_OWNER_BLOCK';exception when others then if sqlerrm<>'PAYMENT_NOT_FOUND' then raise;end if;end;
 insert into asset_control_results values('other_user_payment_blocked',true);
end $$;
reset role;
select * from asset_control_results;
do $$ begin if exists(select 1 from asset_control_results where not passed) then raise exception 'ASSET_CONTROL_TEST_FAILED';end if;end $$;
