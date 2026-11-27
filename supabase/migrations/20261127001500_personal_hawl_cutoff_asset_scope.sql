-- Scope the continuity validation to accounts with evidence by the assessment cutoff.
create or replace function private.personal_hawl_continuity(p_cycle uuid, p_method uuid, p_cutoff date)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  actor uuid:=auth.uid();
  cycle public.zakat_hawl_cycles%rowtype;
  base_currency text;
  calendar text;
  standard text;
  preference text;
  quote_grams numeric;
  effective_start date;
  due_date date;
  original_due date;
  closing record;
  current_day date;
  movement_ids uuid[];
  quote_ids uuid[];
  opening_movements uuid[];
  opening_quotes uuid[];
  recovery_movements uuid[];
  recovery_quotes uuid[];
  evidence_hash text:='';
  qualifies boolean;
  unsupported_asset boolean;
  unreconciled_balance boolean;
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  select c.* into cycle from public.zakat_hawl_cycles c where c.id=p_cycle and c.user_id=actor and c.status in ('ACTIVE','OPEN');
  if not found or cycle.cycle_no<>1
    or cycle.snapshot->>'personal_start_policy' is distinct from 'FIRST_NISAB_V1'
    or cycle.snapshot->'nisabEvidence'->>'status' is distinct from 'PROVEN'
  then return null; end if;
  select s.hawl_nisab_policy into preference from public.user_settings s where s.user_id=actor;
  if coalesce(preference,'CONTINUOUS')<>'CONTINUOUS' then
    if cycle.snapshot->'activeHawlContinuity'->>'effectiveStart'<>cycle.hawl_start_date::text then
      raise exception 'HAWL_CONTINUITY_POLICY_CHANGED_REVIEW';
    end if;
    return null;
  end if;
  select m.calendar_type into strict calendar from public.zakat_methods m where m.id=p_method;
  select p.base_currency into strict base_currency from public.profiles p where p.id=actor;
  standard:=cycle.nisab_standard;
  quote_grams:=case standard when 'GOLD' then 85 when 'SILVER' then 595 end;
  if quote_grams is null or p_cutoff is null or p_cutoff<cycle.hawl_start_date then
    raise exception 'HAWL_CONTINUITY_EVIDENCE_REQUIRED';
  end if;
  if p_cutoff>cycle.hawl_start_date+interval '3 years' then
    raise exception 'HAWL_CONTINUITY_OVERDUE_REVIEW';
  end if;

  -- Later acquisitions must not affect an earlier assessment. Reconcile each
  -- relevant account against current inventory using its complete movement ledger.
  with relevant_accounts as materialized (
    select a.id,a.asset_type,a.unit,a.currency,a.metadata
    from public.asset_accounts a
    where a.user_id=actor and a.ownership_scope='PERSONAL' and a.organization_id is null and a.is_zakatable
      and (
        exists(select 1 from public.transactions t where t.asset_account_id=a.id and t.user_id=actor
          and t.organization_id is null and t.transaction_date<=p_cutoff)
        or exists(select 1 from public.lots l where l.asset_account_id=a.id and l.user_id=actor
          and l.organization_id is null and l.acquisition_date<=p_cutoff and l.remaining_quantity>0)
      )
  )
  select exists(
    select 1 from relevant_accounts a
    where (a.asset_type in ('GOLD','SILVER') and a.unit is distinct from 'g')
       or (a.asset_type not in ('GOLD','SILVER') and (a.asset_type not in ('CASH','BANK') or a.currency is distinct from base_currency))
       or (a.asset_type='GOLD' and coalesce((a.metadata->>'karat')::numeric,24) not between 1 and 24)
       or (a.asset_type='SILVER' and coalesce((a.metadata->>'purity')::numeric,(a.metadata->>'karat')::numeric,999) not between 0.00000001 and 1000)
  ), exists(
    select 1 from relevant_accounts a
    cross join lateral (
      select sum(case when t.transaction_type in ('PURCHASE','ADD','TRANSFER_IN','OPENING_BALANCE') then t.quantity else -t.quantity end) qty,
        bool_or(t.quantity<0 or t.transaction_type not in ('PURCHASE','ADD','TRANSFER_IN','OPENING_BALANCE','SALE','TRANSFER_OUT','WITHDRAWAL','ZAKAT_PAYMENT')) unsupported
      from public.transactions t where t.asset_account_id=a.id and t.user_id=actor and t.organization_id is null
    ) ledger
    cross join lateral (
      select sum(l.remaining_quantity) qty from public.lots l
      where l.asset_account_id=a.id and l.user_id=actor and l.organization_id is null
    ) inventory
    where ledger.unsupported or coalesce(ledger.qty,0)<>coalesce(inventory.qty,0)
  ) into unsupported_asset,unreconciled_balance;

  if unsupported_asset then raise exception 'HAWL_CONTINUITY_UNSUPPORTED_ASSET'; end if;
  if unreconciled_balance then raise exception 'HAWL_CONTINUITY_UNRECONCILED_BALANCE'; end if;

  original_due:=public.zakat_next_hawl_date(cycle.hawl_start_date,calendar);
  effective_start:=cycle.hawl_start_date;
  due_date:=original_due;
  for closing in
    with movements as materialized (
      select t.id,t.transaction_date as day,
        case when a.asset_type in ('GOLD','SILVER') then a.asset_type::text else 'CASH' end kind,
        case when t.transaction_type in ('PURCHASE','ADD','TRANSFER_IN','OPENING_BALANCE') then t.quantity else -t.quantity end
        * case a.asset_type
            when 'GOLD' then coalesce((a.metadata->>'karat')::numeric,24)/24
            when 'SILVER' then case when coalesce((a.metadata->>'purity')::numeric,(a.metadata->>'karat')::numeric,999)>1
              then coalesce((a.metadata->>'purity')::numeric,(a.metadata->>'karat')::numeric,999)/1000
              else coalesce((a.metadata->>'purity')::numeric,(a.metadata->>'karat')::numeric,999) end
            else 1 end units
      from public.transactions t join public.asset_accounts a on a.id=t.asset_account_id and a.user_id=actor
      where t.user_id=actor and t.organization_id is null and t.transaction_date<=p_cutoff
        and a.ownership_scope='PERSONAL' and a.organization_id is null and a.is_zakatable
    ), changes as (
      select greatest(day,cycle.hawl_start_date) as day,
        coalesce(sum(units) filter (where kind='GOLD'),0) gold,
        coalesce(sum(units) filter (where kind='SILVER'),0) silver,
        coalesce(sum(units) filter (where kind='CASH'),0) cash,
        array_agg(id order by id) movement_ids
      from movements group by greatest(day,cycle.hawl_start_date)
    ), balances as (
      select d.day::date as day,
        sum(coalesce(c.gold,0)) over(order by d.day) gold,
        sum(coalesce(c.silver,0)) over(order by d.day) silver,
        sum(coalesce(c.cash,0)) over(order by d.day) cash,c.movement_ids
      from generate_series(cycle.hawl_start_date::timestamp,p_cutoff::timestamp,'1 day') d(day)
      left join changes c on c.day=d.day::date
    )
    select b.*,g.minimum gold_price,g.minimum=g.maximum gold_agrees,g.ids gold_ids,
        s.minimum silver_price,s.minimum=s.maximum silver_agrees,s.ids silver_ids
    from balances b
    left join lateral (
      select min(p.price_per_unit) minimum,max(p.price_per_unit) maximum,array_agg(p.id order by p.id) ids
      from public.market_prices p where p.valuation_date=b.day and p.asset_type='GOLD' and p.currency=base_currency
        and (p.instrument_code is null or p.instrument_code='XAU') and (p.karat is null or p.karat=24) and nullif(p.source,'') is not null
    ) g on b.cash<>0 or (standard='GOLD' and b.silver<>0) or (standard='SILVER' and b.gold<>0)
      or (standard='GOLD' and (b.day=cycle.hawl_start_date or b.movement_ids is not null))
    left join lateral (
      select min(p.price_per_unit) minimum,max(p.price_per_unit) maximum,array_agg(p.id order by p.id) ids
      from public.market_prices p where p.valuation_date=b.day and p.asset_type='SILVER' and p.currency=base_currency
        and (p.instrument_code is null or p.instrument_code='XAG') and (p.karat is null or p.karat=999) and nullif(p.source,'') is not null
    ) s on b.cash<>0 or (standard='GOLD' and b.silver<>0) or (standard='SILVER' and b.gold<>0)
      or (standard='SILVER' and (b.day=cycle.hawl_start_date or b.movement_ids is not null))
    order by b.day
  loop
    current_day:=closing.day;
    if effective_start is not null and current_day>due_date then
      raise exception 'HAWL_CONTINUITY_OVERDUE_REVIEW';
    end if;
    if least(closing.gold,closing.silver,closing.cash)<0 then
      raise exception 'HAWL_CONTINUITY_UNRECONCILED_BALANCE';
    end if;
    movement_ids:=coalesce(closing.movement_ids,array[]::uuid[]);
    quote_ids:=array[]::uuid[];
    if closing.cash=0 and (case standard when 'GOLD' then closing.silver else closing.gold end)=0 then
      -- A single holding in the standard metal can be compared in pure grams.
      qualifies:=(case standard when 'GOLD' then closing.gold else closing.silver end)>=quote_grams;
      quote_ids:=case when standard='GOLD' and closing.gold_agrees and closing.gold_price>0 then closing.gold_ids
        when standard='SILVER' and closing.silver_agrees and closing.silver_price>0 then closing.silver_ids else quote_ids end;
    else
      if ((standard='GOLD' or closing.gold<>0) and (coalesce(closing.gold_price,0)<=0 or not coalesce(closing.gold_agrees,false)))
        or ((standard='SILVER' or closing.silver<>0) and (coalesce(closing.silver_price,0)<=0 or not coalesce(closing.silver_agrees,false)))
      then raise exception 'HAWL_CONTINUITY_DATED_PRICE_REQUIRED' using detail=current_day::text; end if;
      quote_ids:=coalesce(closing.gold_ids,array[]::uuid[])||coalesce(closing.silver_ids,array[]::uuid[]);
      qualifies:=closing.cash+closing.gold*coalesce(closing.gold_price,0)+closing.silver*coalesce(closing.silver_price,0)
        >=quote_grams*(case standard when 'GOLD' then closing.gold_price else closing.silver_price end);
    end if;
    if current_day=cycle.hawl_start_date then
      if not qualifies then raise exception 'HAWL_CONTINUITY_OPENING_EVIDENCE_CHANGED'; end if;
      opening_movements:=movement_ids;
      opening_quotes:=quote_ids;
    end if;
    if not qualifies then
      effective_start:=null;
    elsif effective_start is null then
      effective_start:=current_day;
      due_date:=public.zakat_next_hawl_date(effective_start,calendar);
      recovery_movements:=movement_ids;
      recovery_quotes:=quote_ids;
    end if;
    evidence_hash:=md5(evidence_hash||jsonb_build_array(current_day,closing.gold,closing.silver,closing.cash,
      closing.gold_price,closing.silver_price,movement_ids,quote_ids,qualifies)::text);
  end loop;
  if effective_start is null then raise exception 'HAWL_CONTINUITY_AWAITING_REATTAINMENT'; end if;
  return jsonb_build_object('version','DAILY_CLOSE_CONTINUITY_V1','effectiveStart',effective_start,'effectiveDue',due_date,
    'originalStart',cycle.hawl_start_date,'originalDue',original_due,'cutoff',p_cutoff,'standard',standard,
    'openingMovementIds',opening_movements,'openingQuoteIds',opening_quotes,
    'recoveryMovementIds',coalesce(recovery_movements,array[]::uuid[]),'recoveryQuoteIds',coalesce(recovery_quotes,array[]::uuid[]),
    'evidenceHash',evidence_hash);
end
$$;
