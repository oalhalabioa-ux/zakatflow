-- Disposable SQL integration for the actual period, save and close contracts.
begin;
do $$
declare
  owner_id uuid:=gen_random_uuid();
  stranger_id uuid:=gen_random_uuid();
  method_id uuid;
  method_code text;
  asset_id uuid;
  tx_id uuid;
  added_lot uuid;
  cycle_id uuid;
  final_id uuid;
  cycle_start date:='2025-03-01';
  cutoff date:='2026-02-18';
  entry record;
  lines jsonb;
  payload jsonb;
  result jsonb;
  expected numeric;
begin
  foreach method_code in array array['INDEPENDENT_LOTS','UNIFIED_HAWL'] loop
    owner_id:=gen_random_uuid();
    select id into strict method_id from public.zakat_methods where code=method_code;
    insert into auth.users(id,email) values(owner_id,owner_id::text||'@pooled-hawl.invalid');
    insert into public.profiles(id,base_currency,zakat_method_id) values(owner_id,'SAR',method_id)
      on conflict(id) do update set base_currency=excluded.base_currency,zakat_method_id=excluded.zakat_method_id;
    perform set_config('request.jwt.claim.sub',owner_id::text,true);
    for entry in select * from (values ('2025-01-01'::date,40),('2025-03-01'::date,50),('2025-07-01'::date,25)) as v(day,qty) loop
      insert into public.asset_accounts(user_id,asset_type,name,currency,unit,ownership_scope,is_zakatable)
        values(owner_id,'GOLD','Synthetic pooled Hawl','SAR','g','PERSONAL',true) returning id into asset_id;
      insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,base_currency,base_value)
        values(owner_id,asset_id,'PURCHASE',entry.day,entry.qty,'SAR','SAR',entry.qty*400) returning id into tx_id;
      insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base)
        values(owner_id,asset_id,tx_id,entry.day,entry.day,entry.qty,entry.qty,entry.qty*400,entry.qty*400) returning id into asset_id;
      if entry.qty=25 then added_lot:=asset_id; end if;
    end loop;
    insert into public.zakat_hawl_cycles(user_id,cycle_no,nisab_standard,nisab_value_base,nisab_reached_date,hawl_start_date,hawl_due_date,status,snapshot)
      values(owner_id,1,'GOLD',34000,cycle_start,cycle_start,cutoff,'ACTIVE','{"personal_start_policy":"FIRST_NISAB_V1"}') returning id into cycle_id;
    execute 'set local role authenticated';
    select coalesce(jsonb_agg(jsonb_build_object(
      'lot_id',l.id,'quantity',l.remaining_quantity,'valuation_price',400,'valuation_currency','SAR','fx_rate',1,
      'valuation_snapshot',jsonb_build_object('purity',1,'hawlStartDate',p.hawl_start_date,'hawlDueDate',p.hawl_due_date,
        'hawlPeriod',p.hawl_period,'periodBasis',p.period_basis),
      'market_value',l.remaining_quantity*400,
      'eligible_value',case when p.hawl_due_date<=cutoff then l.remaining_quantity*400 else 0 end,
      'zakat_amount',case when p.hawl_due_date<=cutoff then l.remaining_quantity*10 else 0 end,
      'explanation','Synthetic pooled Hawl line','eligibility_status',case when p.hawl_due_date<=cutoff then 'ELIGIBLE' else 'HAWL_NOT_COMPLETED' end
    ) order by l.remaining_quantity),'[]'::jsonb)
    into lines
    from public.personal_zakat_assessment_periods(cycle_id,method_id) p
    join public.lots l on l.id=p.lot_id;
    expected:=case when method_code='UNIFIED_HAWL' then 1150 else 900 end;
    payload:=jsonb_build_object(
      'method_id',method_id,'hawl_cycle_id',cycle_id,'currency','SAR','assessment_date',cutoff,'valuation_date',cutoff,
      'nisab_standard','GOLD','nisab_quantity',85,'nisab_value_base',34000,'zakat_rate',0.025,
      'total_zakatable_value',expected/0.025,'zakat_due',expected,
      'calculation_snapshot',jsonb_build_object(
        'schemaVersion',2,'candidateLots',3,'hawlPeriodPolicy','FINAL_COVERAGE_V1','calendarType','HIJRI',
        'priceMode','MANUAL','prices',jsonb_build_object('gold',400),
        'metalPrices',jsonb_build_object('GOLD',jsonb_build_object('price',400,'fxRate',1)),
        'nisabQualificationBasis','PORTFOLIO_MARKET_VALUE','nisabQualificationValue',46000
      )
    );
    if method_code='UNIFIED_HAWL' then
      begin
        perform public.save_zakat_assessment_snapshot(payload,lines);
        raise exception 'Unversioned pool snapshot accepted';
      exception when raise_exception then
        if sqlerrm<>'POOLED_HAWL_RECALCULATION_REQUIRED' then raise; end if;
      end;
      payload:=jsonb_set(payload,'{calculation_snapshot,personalHawlPeriodPolicy}','"PERSONAL_POOL_V1"');
      begin
        perform public.save_zakat_assessment_snapshot(payload,jsonb_set(lines,'{0,eligible_value}','0'));
        raise exception 'Incorrect pooled basis accepted';
      exception when raise_exception then
        if sqlerrm<>'POOLED_HAWL_LINE_BASIS_MISMATCH' then raise; end if;
      end;
    end if;
    if (select count(*) from public.zakat_assessments where user_id=owner_id)<>0 then
      raise exception 'Rejected save left an assessment';
    end if;
    result:=public.save_zakat_assessment_snapshot(payload,lines);
    final_id:=(result->>'id')::uuid;
    if method_code='UNIFIED_HAWL' then
      if result->'calculation_snapshot'->>'personalHawlWitness' is null then
        raise exception 'Missing server-owned pool witness';
      end if;
      begin
        insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,base_currency,base_value)
          select owner_id,l.asset_account_id,'PURCHASE',cutoff,1,'SAR','SAR',400
          from public.lots l where l.id=added_lot returning id,asset_account_id into tx_id,asset_id;
        insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base)
          values(owner_id,asset_id,tx_id,cutoff,cutoff,1,1,400,400);
        perform public.close_zakat_cycle(cycle_id,final_id);
        raise exception 'Pool closed with a stale assessment';
      exception when raise_exception then
        if sqlerrm<>'POOLED_HAWL_RECALCULATION_REQUIRED' then raise; end if;
      end;
    end if;
    perform public.close_zakat_cycle(cycle_id,final_id);
    if (select final_zakat_due from public.zakat_hawl_cycles where id=cycle_id) is distinct from expected then
      raise exception 'Wrong final amount for %',method_code;
    end if;
    if not exists(select 1 from public.zakat_lot_hawl_periods('HIJRI') p where p.lot_id=added_lot and (
        (method_code='UNIFIED_HAWL' and p.covered_through=cutoff and p.hawl_due_date>'2026-09-15' and p.hawl_period=2)
        or (method_code='INDEPENDENT_LOTS' and p.covered_through is null and p.hawl_due_date='2026-06-21' and p.hawl_period=1)
      )) then raise exception 'Wrong post-final coverage for %',method_code; end if;
    perform set_config('request.jwt.claim.sub',stranger_id::text,true);
    if exists(select 1 from public.personal_zakat_assessment_periods(cycle_id,method_id)) then
      raise exception 'Foreign owner saw assessment periods';
    end if;
    execute 'reset role';
  end loop;
  raise notice 'PASS personal pooled Hawl final, coverage and owner scope';
end $$;
rollback;
