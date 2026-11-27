-- Disposable, full canonical schema acceptance for personal supplier purchases.
begin;
set local plpgsql.check_asserts=on;
do $$
declare
  actor uuid:=gen_random_uuid();
  other_actor uuid:=gen_random_uuid();
  bank uuid;
  payload jsonb;
  terms jsonb;
  request_id uuid:=gen_random_uuid();
  purchase jsonb;
  payable uuid;
  bank_before numeric:=150000;
  source uuid;
  payment jsonb;
  last_payment_id uuid;
  reversal_id uuid;
  down_tx uuid;
  proof jsonb;
  credit jsonb;
  opening_lot jsonb;
  partial numeric;
  actor_lots integer;
begin
  insert into auth.users(id,email,email_confirmed_at)
  values(actor,actor||'@supplier-qa.invalid',now()),(other_actor,other_actor||'@supplier-qa.invalid',now());
  update public.profiles set base_currency='SAR' where id in(actor,other_actor);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  set local role authenticated;
  bank:=(public.open_financial_account(jsonb_build_object(
    'request_id',gen_random_uuid(),'scope','PERSONAL','organization_id',null,'entity_id',null,
    'type','BANK','name','Synthetic personal bank','currency','SAR','opening_balance',bank_before,
    'opening_date','2026-01-01','hawl_start_date','2025-10-01','fx_rate',1))->>'id')::uuid;
  select to_jsonb(l) into opening_lot from public.lots l where l.asset_account_id=bank;
  assert opening_lot is not null;
  payload:=jsonb_build_object('ownership_scope','PERSONAL','asset_type','OTHER','is_zakatable',false,
    'name','Synthetic non-zakatable asset','currency','SAR','metadata',jsonb_build_object(
      'acquisition_mode','PURCHASE','quantity',1,'purchase_date','2026-02-01',
      'purchase_value',100000,'vat_amount',0,'invoice_reference','PERSONAL-ASSET-QA'));
  terms:=jsonb_build_object('mode','INSTALLMENTS','supplier_name','Synthetic supplier','down_payment_account_id',bank,
    'entries',jsonb_build_array(jsonb_build_object('kind','DOWN_PAYMENT','due_date','2026-02-01','principal','20000'))||
    (select jsonb_agg(jsonb_build_object('kind','INSTALLMENT','due_date',(date '2026-03-01'+make_interval(months=>n))::date,
      'principal','8000') order by n) from generate_series(0,9) n));
  select count(*) into actor_lots from public.lots where user_id=actor;
  begin
    perform public.create_personal_supplier_asset(payload,gen_random_uuid(),jsonb_set(terms,'{down_payment_account_id}',to_jsonb(gen_random_uuid())));
    raise exception 'Accepted unowned bank';
  exception when others then
    if sqlerrm<>'PERSONAL_CASH_ACCESS_DENIED' then raise;end if;
  end;
  begin
    perform public.create_personal_supplier_asset(payload,gen_random_uuid(),jsonb_set(terms,'{entries,1,principal}','"8001"'));
    raise exception 'Accepted incorrect schedule';
  exception when others then
    if sqlerrm<>'PERSONAL_SUPPLIER_SCHEDULE_TOTAL_MISMATCH' then raise;end if;
  end;
  assert not exists(select 1 from public.personal_payables where user_id=actor);
  assert not exists(select 1 from public.transactions where user_id=actor and transaction_type='PURCHASE');
  assert (select count(*) from public.lots where user_id=actor)=actor_lots;
  assert (select sum(remaining_quantity) from public.lots where asset_account_id=bank)=bank_before;

  purchase:=public.create_personal_supplier_asset(payload,request_id,terms);
  source:=(purchase->>'id')::uuid;
  payable:=(purchase->>'payable_id')::uuid;
  assert source is not null and payable is not null;
  assert (public.create_personal_supplier_asset(payload,request_id,terms)->>'payable_id')::uuid=payable;
  begin
    perform public.create_personal_supplier_asset(payload,request_id,jsonb_set(terms,'{supplier_name}','"Changed supplier"'));
    raise exception 'Changed retry accepted';
  exception when others then
    if sqlerrm<>'ASSET_REQUEST_CONFLICT' then raise;end if;
  end;
  begin
    update public.asset_accounts set is_zakatable=true where id=source;
    raise exception 'Allowed scope changing edit';
  exception when others then
    if sqlerrm<>'PERSONAL_SUPPLIER_USE_ASSET_SOURCE' then raise;end if;
  end;
  begin
    perform public.personal_payable_command(jsonb_build_object('action','CANCEL','payable_id',payable,'reason','Attempt standalone cancellation'));
    raise exception 'Allowed standalone debt cancellation';
  exception when others then
    if sqlerrm<>'PERSONAL_PAYABLE_HAS_PAYMENTS' then raise;end if;
  end;
  proof:=public.read_personal_supplier_schedule(source,'2026-02-01');
  assert (proof->>'asset_cost')::numeric=100000 and (proof->>'remaining')::numeric=80000;
  assert jsonb_array_length(proof->'applications')=1;
  assert (proof#>>'{applications,0,amount}')::numeric=20000;
  down_tx:=(proof#>>'{applications,0,transaction_id}')::uuid;
  assert (select quantity from public.transactions where id=down_tx)=20000;
  assert (select sum(remaining_quantity) from public.lots where asset_account_id=bank)=130000;
  assert public.read_personal_supplier_schedule(source,'2026-01-31') is null;
  assert (select is_zakatable from public.asset_accounts where id=source)=false;
  assert not exists(select 1 from public.financial_events where created_by=actor);

  foreach partial in array array[4000,4000,8000,64000] loop
    payment:=jsonb_build_object('action','PAY','request_id',gen_random_uuid(),
      'payable_id',payable,'account_id',bank,'amount',partial,'date','2026-03-01','notes','Synthetic installment');
    last_payment_id:=(public.personal_payable_command(payment)->>'id')::uuid;
    assert (public.personal_payable_command(payment)->>'id')::uuid=last_payment_id;
    proof:=public.read_personal_supplier_schedule(source,'2026-03-01');
    if (proof->>'applied')::numeric=24000 then
      assert (proof#>>'{entries,1,applied}')::numeric=4000 and (proof#>>'{entries,1,remaining}')::numeric=4000;
    end if;
    assert (select sum((x->>'remaining')::numeric) from jsonb_array_elements(proof->'entries') x)=(proof->>'remaining')::numeric;
    assert (select sum(remaining_value_base) from public.lots where asset_account_id=source)=100000;
  end loop;
  assert (proof->>'remaining')::numeric=0 and (select sum(remaining_quantity) from public.lots where asset_account_id=bank)=50000;
  begin
    perform public.personal_payable_command(payment||jsonb_build_object('request_id',gen_random_uuid(),'amount',1));
    raise exception 'Accepted overpayment';
  exception when others then
    if sqlerrm<>'PERSONAL_PAYABLE_OVERPAYMENT' then raise;end if;
  end;
  begin
    perform public.reverse_personal_supplier_asset(source);
    raise exception 'Reversed purchase with active installments';
  exception when others then
    if sqlerrm<>'PERSONAL_SUPPLIER_REVERSE_INSTALLMENTS_FIRST' then raise;end if;
  end;
  assert (select sum(remaining_value_base) from public.lots where asset_account_id=source)=100000;

  perform public.personal_payable_command(jsonb_build_object('action','REVERSE_PAYMENT','payable_id',payable,
    'payment_id',last_payment_id,'reason','Reverse final installment'));
  proof:=public.read_personal_supplier_schedule(source,null);
  assert (proof->>'remaining')::numeric=64000 and (select sum(remaining_quantity) from public.lots where asset_account_id=bank)=114000;
  assert (public.read_personal_supplier_schedule(source,'2026-03-01')->>'remaining')::numeric=0;
  for last_payment_id in select id from public.personal_payable_payments where payable_id=payable and transaction_id<>down_tx loop
    perform public.personal_payable_command(jsonb_build_object('action','REVERSE_PAYMENT','payable_id',payable,
      'payment_id',last_payment_id,'reason','Unwind remaining installment'));
  end loop;
  reversal_id:=public.reverse_personal_supplier_asset(source);
  assert reversal_id=public.reverse_personal_supplier_asset(source);
  proof:=public.read_personal_supplier_schedule(source,null);
  assert proof->>'status'='REVERSED' and (proof->>'applied')::numeric=0 and (proof->>'remaining')::numeric=0;
  assert (select sum(remaining_quantity) from public.lots where asset_account_id=bank)=bank_before;
  assert (select sum(remaining_value_base) from public.lots where asset_account_id=bank)=bank_before;
  assert (select sum(remaining_value_base) from public.lots where asset_account_id=source)=0;
  assert (select to_jsonb(l)->>'origin_hawl_start_date' from public.lots l where asset_account_id=bank)=opening_lot->>'origin_hawl_start_date';
  assert (select to_jsonb(l)->>'hawl_start_date' from public.lots l where asset_account_id=bank)=opening_lot->>'hawl_start_date';
  assert (public.read_personal_supplier_schedule(source,'2026-02-01')->>'remaining')::numeric=80000;
  assert (select count(*) from public.transactions where reversal_of_transaction_id=down_tx)=1;

  credit:=public.create_personal_supplier_asset(jsonb_set(payload,'{metadata,vat_amount}','15000'),gen_random_uuid(),
    jsonb_build_object('mode','DEFERRED','supplier_name','Synthetic credit supplier','entries',
      jsonb_build_array(jsonb_build_object('kind','INSTALLMENT','due_date','2026-12-01','principal','115000'))));
  proof:=public.read_personal_supplier_schedule((credit->>'id')::uuid,null);
  assert (proof->>'asset_cost')::numeric=115000 and (proof->>'remaining')::numeric=115000;
  assert jsonb_array_length(proof->'applications')=0;
  begin
    perform public.personal_payable_command(jsonb_build_object('action','CANCEL','payable_id',(credit->>'payable_id')::uuid,
      'reason','Attempt standalone cancellation'));
    raise exception 'Independent debt cancellation accepted';
  exception when others then
    if sqlerrm<>'PERSONAL_SUPPLIER_USE_ASSET_SOURCE' then raise;end if;
  end;
  assert (select sum(remaining_quantity) from public.lots where asset_account_id=bank)=bank_before;
  assert not exists(select 1 from public.zakat_hawl_cycles where user_id=actor);
  assert not exists(select 1 from public.zakat_assessments where user_id=actor);

  perform set_config('request.jwt.claim.sub',other_actor::text,true);
  assert not exists(select 1 from public.personal_asset_supplier_schedules where asset_id=source);
  begin
    perform public.read_personal_supplier_schedule(source,null);
    raise exception 'Foreign read accepted';
  exception when others then
    if sqlerrm<>'PERSONAL_SUPPLIER_ACCESS_DENIED' then raise;end if;
  end;
  assert not has_function_privilege('anon','public.create_personal_supplier_asset(jsonb,uuid,jsonb)','execute');
  assert not has_table_privilege('authenticated','public.personal_asset_supplier_schedules','insert');
  perform set_config('qa.personal_supplier',jsonb_build_object('asset_cost',100000,'remaining_at_purchase',80000,
    'remaining_after_reversal',64000,'bank_after_full_reversal',150000,'credit_vat_total',115000,'isolated',true)::text,true);
end
$$;
select current_setting('qa.personal_supplier')::jsonb as acceptance;
rollback;
