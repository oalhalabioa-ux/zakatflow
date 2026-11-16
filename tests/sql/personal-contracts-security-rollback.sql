begin;
set local statement_timeout='45s';
do $$declare uid uuid:=gen_random_uuid();other_uid uuid:=gen_random_uuid();begin
 insert into auth.users(id,email,aud,role)values(uid,'pc-security-'||uid||'@example.invalid','authenticated','authenticated'),(other_uid,'pc-security-'||other_uid||'@example.invalid','authenticated','authenticated');
 insert into public.profiles(id,base_currency)values(uid,'SAR'),(other_uid,'SAR')on conflict(id)do nothing;
 perform set_config('request.jwt.claim.sub',uid::text,true);perform set_config('qa.personal_other',other_uid::text,true);perform set_config('qa.personal_owner',uid::text,true);
end$$;
set local role authenticated;
do $test$
declare bank uuid;t jsonb;p jsonb;r jsonb;c uuid;f jsonb;root uuid;inst uuid;s text;err text;n numeric;cash_before numeric;old_uid text;count_tests int:=0;cur date:=(now()at time zone 'Asia/Riyadh')::date;
begin
 bank:=(public.open_financial_account(jsonb_build_object('request_id',gen_random_uuid(),'scope','PERSONAL','type','BANK','name','Synthetic security bank','currency','SAR','opening_balance',10000,'opening_date','2026-09-01','fx_rate',1))->>'id')::uuid;
 foreach s in array array['RECEIVABLE','PAYABLE']loop
  r:=public.personal_financing_command(jsonb_build_object('action','FUND','request_id',gen_random_uuid(),'kind','LOAN','side',s,'party','Synthetic previous loan','description','Synthetic previous funding','reference','LEGACY-PC','amount',100,'date','2026-09-01','due_date',cur,'account_id',bank));
  select to_jsonb(x)into f from public.personal_financings x where id=(r->>'id')::uuid;root:=coalesce((f->>'receivable_id')::uuid,(f->>'payable_id')::uuid);
  if s='RECEIVABLE'then perform public.transfer_personal_financial_account(jsonb_build_object('action','COLLECT','request_id',gen_random_uuid(),'source_id',root,'destination_id',bank,'amount',20,'date',cur,'notes','Synthetic prior collection'));
  else perform public.personal_payable_command(jsonb_build_object('action','PAY','request_id',gen_random_uuid(),'payable_id',root,'account_id',bank,'amount',20,'date',cur,'notes','Synthetic prior payment'));end if;
  select sum(remaining_value_base)into cash_before from public.lots where asset_account_id=bank;
  t:=jsonb_build_object('product','QARD','side',s,'mode','LINKED','party','Synthetic previous loan','reference','LINK-PC','description','Synthetic link remaining balance','principal',80,'date',cur,'currency','SAR','account_id',null,'source_id',root,'schedule',jsonb_build_array(jsonb_build_object('amount',30,'due_date',cur),jsonb_build_object('amount',50,'due_date',cur+30)),'finance',null,'profit_share',0,'zakatable',true);
  r:=public.personal_contract_command(jsonb_build_object('action','SAVE','request_id',gen_random_uuid(),'payload',t));c:=(r->>'id')::uuid;
  -- Optimistic editing retains a custom schedule and rejects a stale editor.
  perform public.personal_contract_command(jsonb_build_object('action','SAVE','request_id',gen_random_uuid(),'id',c,'expected_revision',0,'payload',t));
  begin perform public.personal_contract_command(jsonb_build_object('action','SAVE','request_id',gen_random_uuid(),'id',c,'expected_revision',0,'payload',t));err:='NOT_BLOCKED';exception when others then err:=sqlerrm;end;
  if err<>'PERSONAL_CONTRACT_CHANGED'then raise exception 'STALE_EDIT_NOT_BLOCKED:%',err;end if;
  perform public.personal_contract_command(jsonb_build_object('action','EXECUTE','id',c,'expected_revision',1,'reason','Synthetic linked contract execution'));
  select sum(remaining_value_base)into n from public.lots where asset_account_id=bank;if n<>cash_before then raise exception 'LINK_MOVED_CASH';end if;
  if(select count(*)from public.personal_contract_installments where contract_id=c)<>2 then raise exception 'INSTALLMENT_SNAPSHOT_MISSING';end if;
  select id into inst from public.personal_contract_installments where contract_id=c and number=1;
  p:=jsonb_build_object('request_id',gen_random_uuid(),'organization_id',null,'debt_id',inst,'target_type',case when s='RECEIVABLE'then 'PERSONAL_RECEIVABLE'else 'PERSONAL_PAYABLE'end,'status','PROMISED','action_date',cur,'next_date',cur+1,'promise_date',cur+1,'promise_amount',30,'assignee_id',null,'note','Synthetic installment followup');perform public.record_debt_followup(p);
  begin perform public.record_debt_followup(p||jsonb_build_object('request_id',gen_random_uuid(),'promise_amount',31));err:='NOT_BLOCKED';exception when others then err:=sqlerrm;end;
  if err<>'PROMISE_EXCEEDS_BALANCE'then raise exception 'INSTALLMENT_OVERPROMISE_NOT_BLOCKED:%',err;end if;
  -- Generic paths cannot bypass the contract or rewrite its linked source.
  begin
   if s='RECEIVABLE'then perform public.transfer_personal_financial_account(jsonb_build_object('action','COLLECT','request_id',gen_random_uuid(),'source_id',root,'destination_id',bank,'amount',1,'date',cur,'notes','Bypass test'));
   else perform public.personal_payable_command(jsonb_build_object('action','PAY','request_id',gen_random_uuid(),'payable_id',root,'account_id',bank,'amount',1,'date',cur,'notes','Bypass test'));end if;
   err:='NOT_BLOCKED';exception when others then err:=sqlerrm;end;
  if err<>'PERSONAL_CONTRACT_USE_SOURCE'then raise exception 'GENERIC_SETTLEMENT_NOT_BLOCKED:%',err;end if;
  select sum(remaining_value_base)into n from public.lots where asset_account_id=bank;if n<>cash_before then raise exception 'REJECTED_BYPASS_MOVED_CASH';end if;
  -- RLS and the definer command both reject another owner.
  perform set_config('request.jwt.claim.sub',current_setting('qa.personal_other'),true);
  if exists(select 1 from public.personal_contracts where id=c)or exists(select 1 from public.personal_contract_installments where contract_id=c)then raise exception 'RLS_LEAK';end if;
  begin perform public.personal_contract_command(jsonb_build_object('action','SETTLE','id',c,'request_id',gen_random_uuid(),'date',cur,'amount',1,'account_id',bank,'reason','Foreign owner test'));err:='NOT_BLOCKED';exception when others then err:=sqlerrm;end;
  if err<>'PERSONAL_CONTRACT_ACCESS_DENIED'then raise exception 'CROSS_OWNER_COMMAND_NOT_BLOCKED:%',err;end if;
  perform set_config('request.jwt.claim.sub',current_setting('qa.personal_owner'),true);
  perform public.personal_contract_command(jsonb_build_object('action','SETTLE','id',c,'request_id',gen_random_uuid(),'date',cur,'amount',20,'account_id',bank,'reason','Synthetic contract payment'));
  count_tests:=count_tests+1;
 end loop;
 -- Future interest is neither a current liability nor available for early combined repayment.
 t:=jsonb_build_object('product','FINANCING','side','PAYABLE','mode','OPENING','party','Future cost test','reference','FUTURE-PC','description','Synthetic future financing','principal',100,'date',cur,'currency','SAR','account_id',null,'source_id',null,'schedule',jsonb_build_array(jsonb_build_object('amount',50,'due_date',cur+30),jsonb_build_object('amount',50,'due_date',((cur+30)+interval '1 month')::date)),'finance',jsonb_build_object('annualRate',12,'method','FLAT','repayment','EQUAL_PRINCIPAL','frequencyMonths',1,'yearDays',365),'profit_share',0,'zakatable',true);
 r:=public.personal_contract_command(jsonb_build_object('action','SAVE','request_id',gen_random_uuid(),'payload',t));c:=(r->>'id')::uuid;perform public.personal_contract_command(jsonb_build_object('action','EXECUTE','id',c,'expected_revision',0,'reason','Future test execute'));
 begin perform public.personal_contract_command(jsonb_build_object('action','CHARGE','id',c,'request_id',gen_random_uuid(),'date',cur,'number',1,'reason','Future cost test'));err:='NOT_BLOCKED';exception when others then err:=sqlerrm;end;if err<>'FINANCE_PERIOD_NOT_ENDED'then raise exception 'FUTURE_COST_NOT_BLOCKED:%',err;end if;
 begin perform public.personal_contract_command(jsonb_build_object('action','SETTLE','id',c,'request_id',gen_random_uuid(),'date',cur,'amount',1,'account_id',bank,'reason','Early finance test'));err:='NOT_BLOCKED';exception when others then err:=sqlerrm;end;if err<>'FINANCE_EARLY_SETTLEMENT_REQUIRES_AMENDMENT'then raise exception 'EARLY_FINANCE_NOT_BLOCKED:%',err;end if;
 perform set_config('qa.pc_security',jsonb_build_object('linked_directions',count_tests,'no_duplicate_cash',true,'optimistic_edit',true,'installment_followup',true,'overpromise_rejected',true,'generic_bypass_rejected',true,'cross_owner_rejected',true,'future_cost_rejected',true,'early_finance_rejected',true,'rollback',true)::text,true);
end$test$;
select current_setting('qa.pc_security')::jsonb as result;
rollback;
