begin;
set local statement_timeout='45s';
do $$declare uid uuid:=gen_random_uuid();begin
 insert into auth.users(id,email,aud,role)values(uid,'personal-contract-test-'||uid||'@example.invalid','authenticated','authenticated');
 insert into public.profiles(id,base_currency)values(uid,'SAR')on conflict(id)do nothing;
 perform set_config('request.jwt.claim.sub',uid::text,true);
end$$;
set local role authenticated;
do $test$
declare bank uuid;p jsonb;t jsonb;r jsonb;c uuid;m uuid;charge uuid;product text;side text;mode text;n numeric;before_cash numeric;charge_amount numeric;req uuid;err text;plan jsonb;count_tests int:=0;
begin
 bank:=(public.open_financial_account(jsonb_build_object('request_id',gen_random_uuid(),'scope','PERSONAL','type','BANK','name','Synthetic contracts bank','currency','SAR','opening_balance',10000,'opening_date','2026-09-01','fx_rate',1))->>'id')::uuid;
 foreach product in array array['QARD','FINANCING','PARTICIPATION']loop foreach side in array array['RECEIVABLE','PAYABLE']loop foreach mode in array array['NEW','OPENING']loop
 t:=jsonb_build_object('product',product,'side',side,'mode',mode,'party','Synthetic contract counterparty','reference','PC-TEST','description','Synthetic personal contract rollback','principal',100,'date','2026-09-01','currency','SAR','account_id',bank,'source_id',null,'schedule',jsonb_build_array(jsonb_build_object('amount',50,'due_date','2026-09-15'),jsonb_build_object('amount',50,'due_date','2026-10-15')),'finance',case when product='FINANCING'then jsonb_build_object('annualRate',12,'method','FLAT','repayment','EQUAL_PRINCIPAL','frequencyMonths',1,'yearDays',365)else 'null'::jsonb end,'profit_share',25,'zakatable',true);
 req:=gen_random_uuid();p:=jsonb_build_object('action','SAVE','request_id',req,'payload',t);r:=public.personal_contract_command(p);c:=(r->>'id')::uuid;
 if(public.personal_contract_command(p)->>'id')::uuid<>c then raise exception 'SAVE_REPLAY_DUPLICATED';end if;
 p:=jsonb_build_object('action','EXECUTE','id',c,'expected_revision',0,'reason','Synthetic execution');perform public.personal_contract_command(p);perform public.personal_contract_command(p);
 select sum(remaining_value_base)into n from public.lots where asset_account_id=bank;
 before_cash:=10000+case when mode='OPENING'then 0 when side='RECEIVABLE'then -100 else 100 end;
 if n<>before_cash then raise exception 'FUNDING_CASH_WRONG % % %: %',product,side,mode,n;end if;
 -- All settlements are performed once; the second identical call is a replay.
 p:=jsonb_build_object('action','SETTLE','id',c,'request_id',gen_random_uuid(),'date',(now()at time zone 'Asia/Riyadh')::date,'amount',20,'account_id',bank,'reason','Synthetic settlement');perform public.personal_contract_command(p);perform public.personal_contract_command(p);
 select id into m from public.personal_contract_movements where contract_id=c and kind='SETTLE'and reversed_at is null;
 perform public.personal_contract_command(jsonb_build_object('action','REVERSE','id',c,'request_id',gen_random_uuid(),'date',(now()at time zone 'Asia/Riyadh')::date,'movement_id',m,'reason','Synthetic settlement correction'));
 if product in('FINANCING','PARTICIPATION')then
  p:=jsonb_build_object('action',case when product='FINANCING'then 'CHARGE'else 'PROFIT'end,'id',c,'request_id',gen_random_uuid(),'date',(now()at time zone 'Asia/Riyadh')::date,'number',1,'amount',40,'reason','Synthetic accrual');perform public.personal_contract_command(p);
  select id,amount into charge,charge_amount from public.personal_contract_movements where contract_id=c and kind in('CHARGE','PROFIT')and reversed_at is null;
  if product='PARTICIPATION'and charge_amount<>10 then raise exception 'PROFIT_SHARE_WRONG';end if;
  perform public.personal_contract_command(jsonb_build_object('action','SETTLE_CHARGE','id',c,'request_id',gen_random_uuid(),'date',(now()at time zone 'Asia/Riyadh')::date,'movement_id',charge,'amount',round(charge_amount/2,4),'account_id',bank,'reason','Synthetic cost or profit settlement'));
  select id into m from public.personal_contract_movements where contract_id=c and kind='SETTLE_CHARGE'and reversed_at is null;
  perform public.personal_contract_command(jsonb_build_object('action','REVERSE','id',c,'request_id',gen_random_uuid(),'date',(now()at time zone 'Asia/Riyadh')::date,'movement_id',m,'reason','Synthetic correction settlement'));
  perform public.personal_contract_command(jsonb_build_object('action','REVERSE','id',c,'request_id',gen_random_uuid(),'date',(now()at time zone 'Asia/Riyadh')::date,'movement_id',charge,'reason','Synthetic correction accrual'));
 end if;
 if product='PARTICIPATION'then
  perform public.personal_contract_command(jsonb_build_object('action','LOSS','id',c,'request_id',gen_random_uuid(),'date',(now()at time zone 'Asia/Riyadh')::date,'amount',100,'reason','Synthetic full capital loss'));
  select id into m from public.personal_contract_movements where contract_id=c and kind='LOSS'and reversed_at is null;
  perform public.personal_contract_command(jsonb_build_object('action','REVERSE','id',c,'request_id',gen_random_uuid(),'date',(now()at time zone 'Asia/Riyadh')::date,'movement_id',m,'reason','Synthetic loss correction'));
 end if;
 select id into m from public.personal_contract_movements where contract_id=c and kind='FUND'and reversed_at is null;
 perform public.personal_contract_command(jsonb_build_object('action','REVERSE','id',c,'request_id',gen_random_uuid(),'date',(now()at time zone 'Asia/Riyadh')::date,'movement_id',m,'reason','Synthetic funding correction'));
 select sum(remaining_value_base)into n from public.lots where asset_account_id=bank;
 if n<>10000 then raise exception 'REVERSE_CASH_WRONG % % %: %',product,side,mode,n;end if;
 count_tests:=count_tests+1;
 end loop;end loop;end loop;
 perform set_config('qa.personal_contracts',jsonb_build_object('product_direction_mode_paths',count_tests,'replay_safe',true,'cash_reconciled',true,'charges_and_profit_separate',true,'full_loss_reversible',true,'rollback',true)::text,true);
end$test$;
select current_setting('qa.personal_contracts')::jsonb as result;
rollback;
