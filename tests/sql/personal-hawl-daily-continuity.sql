begin;

create function pg_temp.save_daily_hawl(p_cycle uuid,p_method uuid,p_date date,p_expected numeric,p_tampered boolean default false)
returns jsonb
language plpgsql as $$
declare context jsonb; lines jsonb; payload jsonb;
begin
  context:=public.personal_zakat_assessment_context(p_cycle,p_method,p_date);
  select jsonb_agg(jsonb_build_object(
    'lot_id',l.id,'quantity',l.remaining_quantity,'valuation_price',400,'valuation_currency','SAR','fx_rate',1,
    'valuation_snapshot',jsonb_build_object('purity',1,'hawlStartDate',p.hawl_start_date,'hawlDueDate',p.hawl_due_date,
      'hawlPeriod',p.hawl_period,'periodBasis',p.period_basis),
    'market_value',l.remaining_quantity*400,
    'eligible_value',case when p.hawl_due_date<=p_date then l.remaining_quantity*400 else 0 end,
    'zakat_amount',case when p.hawl_due_date<=p_date then l.remaining_quantity*10 else 0 end,
    'explanation','Synthetic daily Hawl line','eligibility_status',case when p.hawl_due_date<=p_date then 'ELIGIBLE' else 'HAWL_NOT_COMPLETED' end
  ) order by l.id)
  into lines
  from jsonb_to_recordset(context->'periods') as p(lot_id uuid,hawl_start_date date,hawl_due_date date,hawl_period integer,period_basis text)
  join public.lots l on l.id=p.lot_id
  join public.asset_accounts a on a.id=l.asset_account_id
  where l.remaining_quantity>0 and a.is_zakatable;
  payload:=jsonb_build_object(
    'method_id',p_method,'hawl_cycle_id',p_cycle,'currency','SAR','assessment_date',p_date,'valuation_date',p_date,
    'nisab_standard','GOLD','nisab_quantity',85,'nisab_value_base',34000,'zakat_rate',0.025,
    'total_zakatable_value',p_expected/0.025,'zakat_due',p_expected,
    'calculation_snapshot',jsonb_build_object(
      'schemaVersion',2,'candidateLots',2,'hawlPeriodPolicy','FINAL_COVERAGE_V1','calendarType','GREGORIAN',
      'priceMode','MANUAL','prices',jsonb_build_object('gold',400),
      'metalPrices',jsonb_build_object('GOLD',jsonb_build_object('price',400,'fxRate',1)),
      'nisabQualificationBasis','PORTFOLIO_MARKET_VALUE','nisabQualificationValue',38000,
      'hawlContinuity',context->'continuity'
    )
  );
  if exists(select 1 from public.zakat_methods where id=p_method and code='UNIFIED_HAWL') then
    payload:=jsonb_set(payload,'{calculation_snapshot,personalHawlPeriodPolicy}','"PERSONAL_POOL_V1"');
  end if;
  if p_tampered then
    payload:=jsonb_set(payload,'{calculation_snapshot,hawlContinuity,evidenceHash}','"changed"');
  end if;
  return public.save_zakat_assessment_snapshot(payload,lines);
end
$$;

do $$
declare
  actor uuid;
  method_id uuid;
  method_code text;
  gold uuid;
  excluded_cash uuid;
  qualifying_cash uuid;
  cash_tx uuid;
  opening_tx uuid;
  recovery_tx uuid;
  cycle_id uuid;
  cross_day boolean;
  old_result jsonb;
  final_result jsonb;
  old_cutoff date:='2026-01-01';
  recovered_cutoff date:='2026-07-01';
  aligned_due date;
  expected numeric;
begin
  foreach cross_day in array array[true,false] loop
    foreach method_code in array array['INDEPENDENT_LOTS','UNIFIED_HAWL'] loop
      actor:=gen_random_uuid();
      update public.zakat_methods m set calendar_type='GREGORIAN' where m.code=method_code returning m.id into strict method_id;
      insert into auth.users(id,email) values(actor,actor::text||'@daily-hawl.invalid');
      insert into public.profiles(id,base_currency,zakat_method_id) values(actor,'SAR',method_id)
        on conflict(id) do update set base_currency=excluded.base_currency,zakat_method_id=excluded.zakat_method_id;
      insert into public.user_settings(user_id,hawl_nisab_policy) values(actor,'CONTINUOUS')
        on conflict(user_id) do update set hawl_nisab_policy=excluded.hawl_nisab_policy;
      perform set_config('request.jwt.claim.sub',actor::text,true);
      insert into public.asset_accounts(user_id,asset_type,name,currency,unit,ownership_scope,is_zakatable)
        values(actor,'GOLD','Daily gold','SAR','g','PERSONAL',true) returning id into gold;
      insert into public.asset_accounts(user_id,asset_type,name,currency,unit,ownership_scope,is_zakatable)
        values(actor,'CASH','Excluded receipt','SAR','SAR','PERSONAL',false) returning id into excluded_cash;
      insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,base_currency,base_value)
        values(actor,gold,'PURCHASE','2025-01-01',90,'SAR','SAR',36000) returning id into opening_tx;
      insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base)
        values(actor,gold,opening_tx,'2025-01-01','2025-01-01',90,90,36000,36000);
      perform public.post_sale_with_proceeds(actor,gold,excluded_cash,
        case when cross_day then '2025-04-01'::date else '2025-07-01'::date end,20,8000,'SAR','SAR',8000);
      insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,base_currency,base_value)
        values(actor,gold,'PURCHASE','2025-07-01',25,'SAR','SAR',10000) returning id into recovery_tx;
      insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base)
        values(actor,gold,recovery_tx,'2025-07-01','2025-07-01',25,25,10000,10000);
      insert into public.zakat_hawl_cycles(user_id,cycle_no,nisab_standard,nisab_reached_date,hawl_start_date,hawl_due_date,status,snapshot)
        values(actor,1,'GOLD','2025-01-01','2025-01-01',old_cutoff,'ACTIVE',
          jsonb_build_object('personal_start_policy','FIRST_NISAB_V1','nisabEvidence',jsonb_build_object('status','PROVEN','movementIds',jsonb_build_array(opening_tx))))
        returning id into cycle_id;
      execute 'set local role authenticated';
      aligned_due:=case when cross_day then recovered_cutoff else old_cutoff end;
      expected:=case when cross_day or method_code='UNIFIED_HAWL' then 950 else 700 end;
      if cross_day and method_code='INDEPENDENT_LOTS' then
        begin
          perform pg_temp.save_daily_hawl(cycle_id,method_id,old_cutoff,0,true);
          raise exception 'Tampered evidence was accepted';
        exception when raise_exception then
          if sqlerrm<>'HAWL_CONTINUITY_RECALCULATION_REQUIRED' then raise; end if;
        end;
        begin
          insert into public.asset_accounts(user_id,asset_type,name,currency,ownership_scope,is_zakatable)
            values(actor,'CASH','Qualifying personal cash','SAR','PERSONAL',true) returning id into qualifying_cash;
          insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,base_currency,base_value)
            values(actor,qualifying_cash,'ADD','2025-01-02',100,'SAR','SAR',100) returning id into cash_tx;
          insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,
            original_quantity,remaining_quantity,original_value_base,remaining_value_base)
            values(actor,qualifying_cash,cash_tx,'2025-01-02','2025-01-02',100,100,100,100);
          perform public.personal_zakat_assessment_context(cycle_id,method_id,'2025-01-02');
          raise exception 'A mixed balance was accepted without a dated price';
        exception when raise_exception then
          if sqlerrm<>'HAWL_CONTINUITY_DATED_PRICE_REQUIRED' then raise; end if;
        end;
      end if;
      old_result:=pg_temp.save_daily_hawl(cycle_id,method_id,old_cutoff,case when cross_day then 0 else expected end);
      if not (old_result->'calculation_snapshot'->'hawlContinuity'->'openingMovementIds' @> jsonb_build_array(opening_tx)) then
        raise exception 'Missing opening movement evidence';
      end if;
      if cross_day then
        if not (old_result->'calculation_snapshot'->'hawlContinuity'->'recoveryMovementIds' @> jsonb_build_array(recovery_tx)) then
          raise exception 'Missing recovery movement evidence';
        end if;
        begin
          perform public.close_zakat_cycle(cycle_id,(old_result->>'id')::uuid);
          raise exception 'Old due permitted finalization';
        exception when raise_exception then
          if sqlerrm<>'CYCLE_HAWL_NOT_COMPLETED' then raise; end if;
        end;
        if not exists(select 1 from public.zakat_hawl_cycles where id=cycle_id and status='ACTIVE' and hawl_due_date=recovered_cutoff and final_assessment_id is null) then
          raise exception 'Continuity did not persist the effective due on the same cycle';
        end if;
        final_result:=pg_temp.save_daily_hawl(cycle_id,method_id,recovered_cutoff,expected);
      else
        final_result:=old_result;
      end if;
      perform public.close_zakat_cycle(cycle_id,(final_result->>'id')::uuid);
      if not exists(select 1 from public.zakat_hawl_cycles where id=cycle_id and status='CLOSED'
        and hawl_due_date=aligned_due and final_zakat_due=expected and hawl_start_date='2025-01-01') then
        raise exception 'Wrong final result for %',method_code;
      end if;
      execute 'reset role';
    end loop;
  end loop;
  raise notice 'PASS daily continuity, cutoff save and final evidence for both methods';
end $$;
-- A price-only reattainment in a mixed portfolio must retain the dated quote ID.
do $$
declare
  actor uuid:=gen_random_uuid();
  method_id uuid;
  cycle_id uuid;
  account_id uuid;
  tx_id uuid;
  quote_id uuid;
  source record;
  evidence jsonb;
begin
  select m.id into strict method_id from public.zakat_methods m where m.code='INDEPENDENT_LOTS';
  insert into auth.users(id,email) values(actor,actor::text||'@daily-hawl-prices.invalid');
  insert into public.profiles(id,base_currency,zakat_method_id) values(actor,'SAR',method_id)
    on conflict(id) do update set base_currency=excluded.base_currency,zakat_method_id=excluded.zakat_method_id;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  for source in select * from (values ('GOLD','g',70,28000),('CASH','SAR',6000,6000)) v(asset_type,unit,qty,value) loop
    insert into public.asset_accounts(user_id,asset_type,name,currency,unit,ownership_scope,is_zakatable)
      values(actor,source.asset_type::public.asset_type,'Daily price fixture','SAR',source.unit,'PERSONAL',true)
      returning id into account_id;
    insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,base_currency,base_value)
      values(actor,account_id,case when source.asset_type='CASH' then 'ADD'::public.transaction_type else 'PURCHASE'::public.transaction_type end,'2025-02-03',source.qty,'SAR','SAR',source.value) returning id into tx_id;
    insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base)
      values(actor,account_id,tx_id,'2025-02-03','2025-02-03',source.qty,source.qty,source.value,source.value);
  end loop;
  insert into public.market_prices(asset_type,instrument_code,valuation_date,currency,price_per_unit,source)
    values('GOLD','XAU','2025-02-03','SAR',400,'SYNTHETIC_DAILY'),
          ('GOLD','XAU','2025-02-04','SAR',450,'SYNTHETIC_DAILY');
  insert into public.market_prices(asset_type,instrument_code,valuation_date,currency,price_per_unit,source)
    values('GOLD','XAU','2025-02-05','SAR',400,'SYNTHETIC_DAILY') returning id into quote_id;
  insert into public.zakat_hawl_cycles(user_id,cycle_no,nisab_standard,nisab_reached_date,hawl_start_date,hawl_due_date,status,snapshot)
    values(actor,1,'GOLD','2025-02-03','2025-02-03','2026-02-03','ACTIVE',
       '{"personal_start_policy":"FIRST_NISAB_V1","nisabEvidence":{"status":"PROVEN"}}')
    returning id into cycle_id;
  execute 'set local role authenticated';
  evidence:=public.personal_zakat_assessment_context(cycle_id,method_id,'2025-02-05')->'continuity';
  if evidence->>'effectiveStart' is distinct from '2025-02-05'
    or evidence->>'effectiveDue' is distinct from '2026-02-05'
    or evidence->'recoveryQuoteIds' is distinct from jsonb_build_array(quote_id)
    or evidence->'recoveryMovementIds' is distinct from '[]'
  then raise exception 'Price-only reattainment evidence is wrong: %',evidence; end if;
  execute 'reset role';
end $$;

rollback;
