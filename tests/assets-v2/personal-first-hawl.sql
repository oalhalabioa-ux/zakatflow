-- Isolated candidate DB. All synthetic records roll back.
begin;
do $$
declare
  owner_id uuid := gen_random_uuid();
  gold_id uuid := gen_random_uuid();
  cash_id uuid := gen_random_uuid();
  purchase_id uuid;
  gold_lot uuid;
  receipt uuid;
  cycle_id uuid;
  policy text;
  expected date;
begin
  insert into auth.users(id) values(owner_id);
  insert into profiles(id,base_currency) values(owner_id,'SAR') on conflict do nothing;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  insert into user_settings(user_id,zakatable_conversion_continuity) values(owner_id,true)
    on conflict(user_id) do update set zakatable_conversion_continuity=true;
  insert into asset_accounts(id,user_id,asset_type,name,currency,unit,is_zakatable) values
    (gold_id,owner_id,'GOLD','Synthetic gold','SAR','g',true),
    (cash_id,owner_id,'CASH','Synthetic cash','SAR','SAR',true);
  insert into transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,base_currency,base_value)
    values(owner_id,gold_id,'PURCHASE','2022-01-01',100,'SAR','SAR',40000) returning id into purchase_id;
  insert into lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base)
    values(owner_id,gold_id,purchase_id,'2022-01-01','2022-01-01',100,100,40000,40000) returning id into gold_lot;
  receipt := (post_sale_with_proceeds(owner_id,gold_id,cash_id,'2025-05-01',2,900,'SAR','SAR',900)->>'proceeds_transaction_id')::uuid;
  insert into zakat_hawl_cycles(user_id,cycle_no,nisab_standard,nisab_reached_date,hawl_start_date,hawl_due_date,status)
    values(owner_id,1,'GOLD','2025-03-15','2025-03-15','2026-03-15','ACTIVE') returning id into cycle_id;
  foreach policy in array array['LEGACY','SETTLED_OPENING_V1','FIRST_NISAB_V1'] loop
    update zakat_hawl_cycles set snapshot=jsonb_build_object('personal_start_policy',policy) where id=cycle_id;
    expected := case when policy='LEGACY' then date '2023-01-01' else date '2026-03-15' end;
    if (select hawl_due_date from zakat_lot_hawl_periods('GREGORIAN') where lot_id=gold_lot) is distinct from expected
      or (select period_due from gold_receipt_assessment_periods(receipt,'GREGORIAN')) is distinct from expected
      then raise exception 'Unexpected gold or cash due date for %',policy; end if;
  end loop;
  -- A new portfolio buys 40 g below Nisab, then crosses 85 g with a 50 g purchase.
  update lots set acquisition_date='2025-03-01',hawl_start_date='2025-03-01',
    original_quantity=40,remaining_quantity=40 where id=gold_lot;
  insert into transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,base_currency,base_value)
    values(owner_id,gold_id,'PURCHASE','2026-02-01',50,'SAR','SAR',21250) returning id into purchase_id;
  insert into lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base)
    values(owner_id,gold_id,purchase_id,'2026-02-01','2026-02-01',50,50,21250,21250);
  update zakat_hawl_cycles set hawl_start_date='2026-02-01',nisab_reached_date='2026-02-01',hawl_due_date='2027-02-01' where id=cycle_id;
  if (select coalesce(sum(l.remaining_quantity*425*.025) filter (where p.hawl_due_date<='2026-03-01'),0) <> 0
       or sum(l.remaining_quantity*425*.025) filter (where p.hawl_due_date<='2027-02-01') is distinct from 956.25
      from zakat_lot_hawl_periods('GREGORIAN') p join lots l on l.id=p.lot_id where l.asset_account_id=gold_id)
    then raise exception 'Unexpected first-Nisab projection'; end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  if personal_first_hawl_start() is not null then raise exception 'Incorrect owner'; end if;
end $$;
rollback;
