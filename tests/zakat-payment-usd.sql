-- Run on QA only. All temporary balances, cycles, payments and audit rows roll back.
begin;
do $$
declare uid uuid;ccy text;bank uuid;cycle uuid;assessment uuid;method uuid;lot uuid;req uuid:=gen_random_uuid();p jsonb;replay jsonb;input jsonb;tx uuid;balance numeric;
begin
 select id,base_currency into uid,ccy from public.profiles where base_currency='SAR' limit 1;
 if uid is null then raise exception 'QA_PROFILE_REQUIRED';end if;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 -- Isolate existing QA cycles; these flags are rolled back too.
 update public.zakat_hawl_cycles set snapshot=coalesce(snapshot,'{}')||'{"historical_settled":true}' where user_id=uid;
 p:=public.open_financial_account(jsonb_build_object('request_id',gen_random_uuid(),'scope','PERSONAL','type','BANK','name','QA Zakat paying bank','currency',ccy,'opening_balance',1000,'opening_date','2026-10-01','fx_rate',1,'notes','Rollback-only test'));
 bank:=(p->>'id')::uuid;
 if bank is null then raise exception 'QA_BANK_CREATION_FAILED';end if;
 select id into lot from public.lots where asset_account_id=bank limit 1;
 select id into method from public.zakat_methods limit 1;
 insert into public.zakat_hawl_cycles(user_id,cycle_no,nisab_standard,nisab_value_base,nisab_reached_date,hawl_start_date,hawl_due_date,status)
 values(uid,(select coalesce(max(cycle_no),0)+1 from public.zakat_hawl_cycles where user_id=uid),'GOLD',100,'2025-10-01','2025-10-01','2026-09-20','OPEN') returning id into cycle;
 insert into public.zakat_assessments(user_id,assessment_date,valuation_date,method_id,nisab_standard,nisab_quantity,nisab_value_base,total_zakatable_value,zakat_rate,zakat_due,currency,status,hawl_cycle_id,assessment_kind)
 values(uid,'2026-09-20','2026-09-20',method,'GOLD',85,100,4000,0.025,100,ccy,'CONFIRMED',cycle,'FINAL') returning id into assessment;
 insert into public.zakat_assessment_lines(assessment_id,lot_id,quantity,market_value,eligible_value,zakat_amount,eligibility_status,explanation)
 values(assessment,lot,1000,4000,4000,100,'ELIGIBLE','Rollback-only assessment fixture');
 update public.zakat_hawl_cycles set status='CLOSED',final_assessment_id=assessment,assessment_id=assessment,final_zakat_due=100 where id=cycle;
 input:=jsonb_build_object('request_id',req,'cash_account_id',bank,'hawl_cycle_id',cycle,'payment_date','2026-10-19','amount',150,'base_amount',150,'currency',ccy,'beneficiary','QA','reference','QA-ZAKAT','notes','Rollback-only payment');
 perform set_config('qa.zakat_test_input',input::text,true);
end $$;
do $$
declare input jsonb:=current_setting('qa.zakat_test_input')::jsonb; uid uuid:=(select user_id from public.asset_accounts where id=(input->>'cash_account_id')::uuid);b jsonb;fx uuid;
begin
 delete from public.fx_rates where organization_id is null and ((from_currency='USD'and to_currency='SAR')or(from_currency='SAR'and to_currency='USD'));
 insert into public.fx_rates(from_currency,to_currency,rate,valuation_date,source)values('USD','SAR',3.75,'2026-10-19','QA_ROLLBACK_ONLY')returning id into fx;
 b:=public.open_financial_account(jsonb_build_object('request_id',gen_random_uuid(),'scope','PERSONAL','type','BANK','name','QA USD paying bank','currency','USD','opening_balance',1000,'opening_date','2026-10-01','fx_rate',3.7,'notes','Rollback only'));
 perform set_config('qa.usd_bank',b->>'id',true);perform set_config('qa.fx_id',fx::text,true);
end $$;
set local role authenticated;
do $$
declare input jsonb:=current_setting('qa.zakat_test_input')::jsonb;uid uuid:=auth.uid();bank uuid:=(input->>'cash_account_id')::uuid;p jsonb;replay jsonb;tx uuid;balance numeric;
begin
 p:=public.write_zakat_payment(input);tx:=(p->>'cash_transaction_id')::uuid;
 if tx is null then raise exception 'CASH_MOVEMENT_MISSING';end if;
 select sum(remaining_value_base) into balance from public.lots where asset_account_id=bank;
 if balance<>850 then raise exception 'BANK_NOT_DEBITED_ONCE';end if;
 if (select sum(allocated_amount) from public.zakat_payment_allocations where payment_id=(p->>'id')::uuid)<>100 then raise exception 'FINAL_FIFO_ALLOCATION_CHANGED';end if;
 replay:=public.write_zakat_payment(input);
 if replay->>'id'<>p->>'id' or(select sum(remaining_value_base) from public.lots where asset_account_id=bank)<>850 then raise exception 'RETRY_DUPLICATED_CASH';end if;
 begin perform public.write_zakat_payment(input||'{"amount":151,"base_amount":151}'::jsonb,(p->>'id')::uuid);raise exception 'POSTED_AMOUNT_EDIT_ACCEPTED';exception when others then if sqlerrm<>'PAYMENT_CASH_FIELDS_LOCKED' then raise;end if;end;
 begin perform public.reverse_transaction(uid,tx);raise exception 'GENERIC_REVERSAL_ACCEPTED';exception when others then if sqlerrm<>'ZAKAT_REVERSE_FROM_PAYMENTS' then raise;end if;end;
 begin perform public.write_zakat_payment(input||jsonb_build_object('request_id',gen_random_uuid(),'amount',2000,'base_amount',2000));raise exception 'OVERDRAFT_ACCEPTED';exception when others then if sqlerrm<>'CASH_INSUFFICIENT_BALANCE' then raise;end if;end;
 if(select sum(remaining_value_base) from public.lots where asset_account_id=bank)<>850 then raise exception 'FAILED_PAYMENT_CHANGED_CASH';end if;
 perform public.write_zakat_payment('{}',(p->>'id')::uuid,true);
 if(select sum(remaining_value_base) from public.lots where asset_account_id=bank)<>1000 then raise exception 'PAYMENT_REVERSAL_NOT_RESTORED';end if;
 if not exists(select 1 from public.transactions where reversal_of_transaction_id=tx)then raise exception 'REVERSAL_TRAIL_MISSING';end if;
 begin perform public.write_zakat_payment(input);raise exception 'REVERSED_REQUEST_REUSED';exception when others then if sqlerrm<>'PAYMENT_REQUEST_REVERSED' then raise;end if;end;
end $$;
do $$
declare input jsonb:=current_setting('qa.zakat_test_input')::jsonb; bank uuid:=(input->>'cash_account_id')::uuid;usd uuid:=current_setting('qa.usd_bank')::uuid;fx uuid:=current_setting('qa.fx_id')::uuid;payload jsonb;p jsonb;r jsonb;tx uuid;
begin
 payload:=input||jsonb_build_object('request_id',gen_random_uuid(),'currency','USD','amount',100,'base_amount',375,'fx_rate_id',fx,'exchange_rate',3.75);
 p:=public.write_zakat_payment(payload);
 if(p->>'base_amount')::numeric<>375 or(p->>'exchange_rate')::numeric<>3.75 or p->>'fx_source'<>'QA_ROLLBACK_ONLY' or(p->>'cash_amount')::numeric<>375 or p->>'cash_currency'<>'SAR' then raise exception 'USD_SAR_PAYMENT_SNAPSHOT_WRONG';end if;
 if(select sum(remaining_value_base) from public.lots where asset_account_id=bank)<>625 then raise exception 'SAR_CASH_DEBIT_WRONG';end if;
 if(select sum(allocated_amount) from public.zakat_payment_allocations where payment_id=(p->>'id')::uuid)<>100 then raise exception 'USD_FINAL_ALLOCATION_WRONG';end if;
 r:=public.write_zakat_payment(payload);if r->>'id'<>p->>'id' then raise exception 'USD_RETRY_NOT_IDEMPOTENT';end if;
 perform public.write_zakat_payment('{}',(p->>'id')::uuid,true);
 if(select sum(remaining_value_base) from public.lots where asset_account_id=bank)<>1000 then raise exception 'USD_SAR_REVERSAL_WRONG';end if;
 begin perform public.write_zakat_payment(payload||jsonb_build_object('request_id',gen_random_uuid(),'base_amount',376));raise exception 'FORGED_BASE_ACCEPTED';exception when others then if sqlerrm<>'PAYMENT_FX_AMOUNT_MISMATCH' then raise;end if;end;
 begin perform public.write_zakat_payment(payload||jsonb_build_object('request_id',gen_random_uuid(),'exchange_rate',3.8));raise exception 'STALE_FX_ACCEPTED';exception when others then if sqlerrm<>'PAYMENT_FX_RATE_CHANGED' then raise;end if;end;
 begin perform public.write_zakat_payment(payload||jsonb_build_object('request_id',gen_random_uuid(),'fx_rate_id',gen_random_uuid()));raise exception 'MISSING_FX_ACCEPTED';exception when others then if sqlerrm<>'PAYMENT_FX_RATE_REQUIRED' then raise;end if;end;
 begin perform public.write_zakat_payment(payload||jsonb_build_object('request_id',gen_random_uuid(),'amount',400,'base_amount',1500));raise exception 'USD_OVERDRAFT_ACCEPTED';exception when others then if sqlerrm<>'CASH_INSUFFICIENT_BALANCE' then raise;end if;end;
 payload:=payload||jsonb_build_object('request_id',gen_random_uuid(),'cash_account_id',usd);
 p:=public.write_zakat_payment(payload);tx:=(p->>'cash_transaction_id')::uuid;
 if(p->>'cash_amount')::numeric<>100 or p->>'cash_currency'<>'USD' or(p->>'cash_book_base')::numeric<>370 or(p->>'base_amount')::numeric<>375 then raise exception 'USD_NATIVE_VS_BASE_MIXED';end if;
 if(select sum(remaining_quantity) from public.lots where asset_account_id=usd)<>900 or(select sum(remaining_value_base) from public.lots where asset_account_id=usd)<>3330 then raise exception 'USD_BANK_DEBIT_WRONG';end if;
 if(select (metadata->>'fx_translation_difference')::numeric from public.transactions where id=tx)<>5 then raise exception 'FX_DIFFERENCE_NOT_PRESERVED';end if;
 r:=public.write_zakat_payment(payload);if r->>'id'<>p->>'id' or(select sum(remaining_quantity) from public.lots where asset_account_id=usd)<>900 then raise exception 'USD_NATIVE_DUPLICATED';end if;
 perform set_config('qa.usd_posted',p::text,true);perform set_config('qa.usd_payload',payload::text,true);
end $$;
reset role;
update public.fx_rates set rate=3.8 where id=current_setting('qa.fx_id')::uuid;
set local role authenticated;
do $$
declare p jsonb:=current_setting('qa.usd_posted')::jsonb;payload jsonb:=current_setting('qa.usd_payload')::jsonb;r jsonb;usd uuid:=current_setting('qa.usd_bank')::uuid;
begin
 r:=public.write_zakat_payment(payload||'{"notes":"Description edit after FX update"}'::jsonb,(p->>'id')::uuid);
 if(r->>'base_amount')::numeric<>375 or(r->>'exchange_rate')::numeric<>3.75 then raise exception 'POSTED_FX_REVALUED';end if;
 perform public.write_zakat_payment('{}',(p->>'id')::uuid,true);
 if(select sum(remaining_quantity) from public.lots where asset_account_id=usd)<>1000 or(select sum(remaining_value_base) from public.lots where asset_account_id=usd)<>3700 then raise exception 'USD_REVERSAL_NOT_RESTORED';end if;
end $$;
select 'PASS: SAR regression, USD via SAR and USD banks, fixed FX snapshot, actual cash currency, allocation, idempotency, forged/stale/missing quotes, overdraft rollback, and reversal' as result;
rollback;
