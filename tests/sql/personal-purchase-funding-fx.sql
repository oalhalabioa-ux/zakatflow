-- Isolated acceptance only. Every source, purchase, reversal and rate rolls back.
begin;
create temporary table purchase_fx_evidence(scenario text, path text, facts jsonb);
grant insert on purchase_fx_evidence to authenticated;
do $fixture$
declare
  actor uuid := gen_random_uuid();
  other_actor uuid := gen_random_uuid();
  scenario record;
  cash_id uuid;
  original_asset_id uuid;
  asset_id uuid;
  purchase_id uuid;
  reversal_id uuid;
  request_id uuid;
  payload jsonb;
  result jsonb;
  posted public.transactions%rowtype;
  withdrawal public.transactions%rowtype;
  returned_cash public.transactions%rowtype;
  expected_payment numeric;
  before_lots jsonb;
  after_lots jsonb;
  expected_fx numeric;
  quantity_used numeric;
  basis_used numeric;
  remaining numeric;
  allocations numeric[];
  transactions_before integer;
  accounts_before integer;
  lot_before integer;
  failure text;
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (actor,actor||'@purchase-fx.invalid',now()),(other_actor,other_actor||'@purchase-fx.invalid',now());
  update public.profiles set base_currency='SAR' where id in (actor,other_actor);
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',actor::text,true);

  for scenario in select * from (values
    ('same_rate','USD',200::numeric,3.75::numeric,0::numeric,0::numeric,0::numeric,375::numeric,100::numeric,null::text),
    ('lower_purchase_rate','USD',200,4,0,0,0,400,100,null),
    ('higher_purchase_rate','USD',200,3.125,0,0,0,312.5,100,null),
    ('mixed_fifo','USD',70,3.7,130,4,0,379,100,null),
    ('exact_units_sufficient','USD',100,3.125,0,0,0,312.5,100,null),
    ('carrying_value_insufficient_units','USD',80,5,0,0,0,0,100,'PERSONAL_PURCHASE_INSUFFICIENT_FUNDS'),
    ('funded_vat','USD',200,4,0,0,15,460,115,null),
    ('funded_vat_insufficient','USD',110,4,0,0,15,0,115,'PERSONAL_PURCHASE_INSUFFICIENT_FUNDS'),
    ('foreign_payment_missing','SAR',500,1,0,0,0,0,null,'PERSONAL_PURCHASE_PAYMENT_REQUIRED'),
    ('foreign_payment_wrong_currency','SAR',500,1,0,0,0,0,374,'PERSONAL_PURCHASE_PAYMENT_REQUIRED'),
    ('foreign_payment_explicit','SAR',500,1,0,0,0,374,374,null),
    ('foreign_payment_precision','SAR',500,1,0,0,0,0,374.001,'PERSONAL_PURCHASE_PAYMENT_INVALID'),
    ('prorata_precision','USD',300,3.333333333333,0,0,0,333.33333333,100,null)
  ) cases(name,payment_currency,first_units,first_rate,second_units,second_rate,vat,cash_basis,paid,error)
  cross join (values(false),(true)) paths(existing)
  loop
    cash_id := (public.create_asset_with_acquisition(jsonb_build_object('name','Synthetic funding',
      'asset_type','BANK','currency',scenario.payment_currency,'ownership_scope','PERSONAL',
      'metadata',jsonb_build_object('quantity',scenario.first_units,'purchase_value',scenario.first_units,
        'purchase_date','2026-01-01','acquisition_mode','OPENING_BALANCE','fx_rate',scenario.first_rate)),gen_random_uuid())->>'id')::uuid;
    if scenario.second_units>0 then
      asset_id := (public.create_asset_with_acquisition(jsonb_build_object('name','Synthetic proceeds source',
        'asset_type','OTHER','currency','USD','ownership_scope','PERSONAL',
        'metadata',jsonb_build_object('quantity',1,'purchase_value',scenario.second_units,
          'purchase_date','2026-01-01','acquisition_mode','OPENING_BALANCE','fx_rate',scenario.second_rate)),gen_random_uuid())->>'id')::uuid;
      perform public.post_sale_with_proceeds(actor,asset_id,cash_id,'2026-01-02',1,scenario.second_units,
        'USD','SAR',scenario.second_units*scenario.second_rate,null);
    end if;
    payload := jsonb_build_object('name','Synthetic purchase','asset_type','OTHER',
      'currency','USD','ownership_scope','PERSONAL',
      'metadata',jsonb_build_object('quantity',1,'purchase_value',100,'purchase_date','2026-02-01',
        'acquisition_mode','PURCHASE','fx_rate',3.75,'fx_rate_date','2026-01-31','fx_rate_source','Synthetic saved quote',
        'fx_source_from','SAR','fx_source_to','USD','vat_amount',scenario.vat,'funding_account_id',cash_id));
    if scenario.payment_currency<>'USD' and scenario.paid is not null then
      payload := jsonb_set(payload,'{metadata}',(payload->'metadata')||
        jsonb_build_object('funding_amount',scenario.paid,'funding_currency',
          case when scenario.name='foreign_payment_wrong_currency' then 'EUR' else scenario.payment_currency end));
    end if;
    if scenario.existing then
      original_asset_id := (public.create_asset_with_acquisition(
        jsonb_set(payload,'{metadata}','{"quantity":1,"purchase_value":1,"purchase_date":"2026-01-01","fx_rate":3.75,"acquisition_mode":"OPENING_BALANCE"}'),
        gen_random_uuid())->>'id')::uuid;
    end if;
    select jsonb_agg(to_jsonb(l) order by id) into before_lots from public.lots l where asset_account_id=cash_id;
    select count(*) into transactions_before from public.transactions where user_id=actor;
    select count(*) into accounts_before from public.asset_accounts where user_id=actor;
    select count(*) into lot_before from public.lots where user_id=actor;

    request_id := gen_random_uuid();
    failure := null;
    begin
      if scenario.existing then
        result := public.purchase_existing_asset(original_asset_id,payload,request_id);
        purchase_id := (result->>'id')::uuid;
      else
        result := public.create_asset_with_acquisition(payload,request_id);
        purchase_id := (result->>'acquisition_transaction_id')::uuid;
      end if;
    exception when others then
      if scenario.error is null or sqlerrm<>scenario.error then raise; end if;
      failure := sqlerrm;
    end;
    if scenario.error is not null then
      if failure is distinct from scenario.error
        or accounts_before<>(select count(*) from public.asset_accounts where user_id=actor)
        or transactions_before<>(select count(*) from public.transactions where user_id=actor)
        or lot_before<>(select count(*) from public.lots where user_id=actor)
        or before_lots is distinct from (select jsonb_agg(to_jsonb(l) order by id) from public.lots l where asset_account_id=cash_id)
      then raise exception 'Purchase failure left partial records in %',scenario.name; end if;
      insert into purchase_fx_evidence values(scenario.name,case when scenario.existing then 'existing' else 'new' end,
        jsonb_build_object('failure',failure,'rolled_back',true));
      continue;
    end if;

    if scenario.existing then
      if (public.purchase_existing_asset(original_asset_id,payload,request_id)->>'id')::uuid is distinct from purchase_id then
        raise exception 'Retry changed the existing-asset voucher';
      end if;
    elsif public.create_asset_with_acquisition(payload,request_id)->>'id' is distinct from result->>'id' then
      raise exception 'Retry changed the asset';
    end if;
    if (select count(*) from public.transactions where user_id=actor)<>transactions_before+2 then
      raise exception 'Retry created an extra purchase or cash transaction in %',scenario.name;
    end if;
    select * into strict posted from public.transactions where id=purchase_id;
    select * into strict withdrawal from public.transactions where asset_account_id=cash_id
      and transaction_type='WITHDRAWAL' and metadata->>'purchase_transaction_id'=purchase_id::text;
    select sum(a.quantity),sum(a.value_base),array_agg(a.quantity order by l.acquisition_date,l.id)
      into quantity_used,basis_used,allocations
      from public.transaction_allocations a join public.lots l on l.id=a.lot_id where a.transaction_id=withdrawal.id;
    select sum(remaining_quantity) into remaining from public.lots where asset_account_id=cash_id;
    expected_payment := scenario.paid;
    expected_fx := round((100+scenario.vat)*3.75,2)-scenario.cash_basis;
    if posted.gross_value<>100 or posted.base_value<>375
      or withdrawal.gross_value<>expected_payment or withdrawal.currency<>scenario.payment_currency
      or withdrawal.quantity<>expected_payment or quantity_used is distinct from expected_payment
      or withdrawal.base_value<>scenario.cash_basis or basis_used is distinct from scenario.cash_basis
      or remaining<>scenario.first_units+scenario.second_units-expected_payment
      or (posted.metadata->'purchase_funding'->>'realized_fx_base')::numeric is distinct from expected_fx
      or posted.metadata->'purchase_funding' is distinct from withdrawal.metadata->'purchase_funding'
      or posted.metadata->'purchase_funding'->>'asset_rate_date'<>'2026-01-31'
      or posted.metadata->'purchase_funding'->>'asset_rate_from'<>'USD'
      or posted.metadata->'purchase_funding'->>'asset_rate_to'<>'SAR'
      or posted.metadata->'purchase_funding'->>'source_rate_from'<>'SAR'
      or posted.metadata->'purchase_funding'->>'asset_rate_source'<>'Synthetic saved quote'
      or (select remaining_value_base from public.lots where source_transaction_id=purchase_id)
        is distinct from round((100+scenario.vat)*3.75,2)
    then raise exception 'Voucher/lot/basis mismatch in %',scenario.name; end if;
    if scenario.name='mixed_fifo' and allocations<>array[70,30]::numeric[] then
      raise exception 'Incorrect FIFO portion in mixed purchase';
    end if;
    after_lots := (select jsonb_agg(to_jsonb(l) order by id) from public.lots l where asset_account_id=cash_id);
    begin
      perform public.reverse_transaction(actor,withdrawal.id);
      raise exception 'Independent funding reversal unexpectedly succeeded';
    exception when others then if sqlerrm<>'REVERSE_FROM_PERSONAL_PURCHASE' then raise; end if; end;

    perform set_config('request.jwt.claim.sub',other_actor::text,true);
    begin
      perform public.reverse_transaction(other_actor,purchase_id);
      raise exception 'Cross-owner reversal unexpectedly succeeded';
    exception when others then if sqlerrm<>'TRANSACTION_NOT_FOUND' then raise; end if; end;
    perform set_config('request.jwt.claim.sub',actor::text,true);

    -- Force a funding restoration failure after the asset lot close would have executed.
    begin
      update public.transaction_allocations set value_base=value_base+1 where transaction_id=withdrawal.id;
      perform public.reverse_transaction(actor,purchase_id);
      raise exception 'Invalid funding reversal unexpectedly succeeded';
    exception when others then if sqlerrm<>'PERSONAL_PURCHASE_FUNDING_ALLOCATION_INVALID' then raise; end if; end;
    if (select remaining_quantity from public.lots where source_transaction_id=purchase_id)<>1
      or after_lots is distinct from (select jsonb_agg(to_jsonb(l) order by id) from public.lots l where asset_account_id=cash_id)
      or exists(select 1 from public.transactions where reversal_of_transaction_id in (purchase_id,withdrawal.id))
    then raise exception 'Failed reversal was partial in %',scenario.name; end if;

    -- A later/higher saved quote must not affect repayment of this original evidence.
    insert into public.personal_fx_rates(user_id,from_currency,to_currency,valuation_date,rate,source)
      values(actor,'USD','SAR',current_date,9,'Later synthetic quote')
      on conflict(user_id,from_currency,to_currency,valuation_date,source) do update set rate=excluded.rate;
    reversal_id := public.reverse_transaction(actor,purchase_id);
    if public.reverse_transaction(actor,purchase_id) is distinct from reversal_id then
      raise exception 'Reversal retry returned another voucher';
    end if;
    select * into strict returned_cash from public.transactions where reversal_of_transaction_id=withdrawal.id;
    if returned_cash.quantity<>expected_payment or returned_cash.base_value<>scenario.cash_basis
      or returned_cash.metadata->'purchase_funding' is distinct from withdrawal.metadata->'purchase_funding'
      or (select metadata->>'funding_reversal_id' from public.transactions where id=reversal_id)<>returned_cash.id::text
      or (select count(*) from public.transactions where user_id=actor)<>transactions_before+4
      or (select count(*) from public.audit_logs where entity_id=reversal_id and action='PERSONAL_PURCHASE_FUNDING_REVERSED')<>1
      or before_lots is distinct from (select jsonb_agg(to_jsonb(l) order by id) from public.lots l where asset_account_id=cash_id)
      or not exists(select 1 from public.lots where source_transaction_id=purchase_id and remaining_quantity=0 and remaining_value_base=0)
    then raise exception 'Reversal did not restore quantity and basis in %',scenario.name; end if;

    insert into purchase_fx_evidence values(scenario.name,case when scenario.existing then 'existing' else 'new' end,
      jsonb_build_object('invoice_net',posted.gross_value,'invoice_total',100+scenario.vat,'payment_currency',withdrawal.currency,
        'payment',withdrawal.gross_value,'consumed',quantity_used,'cash_basis',basis_used,'realized_fx',expected_fx,
        'remaining',remaining,'allocation_units',allocations,'restored_units',returned_cash.quantity,
        'restored_basis',returned_cash.base_value,'reversal_rolled_back_on_failure',true,
        'single_withdrawal_on_retry',true,'single_reversal_pair_on_retry',true));
  end loop;
end $fixture$;
reset role;
select jsonb_agg(jsonb_build_object('scenario',scenario,'path',path)||facts order by scenario,path) from purchase_fx_evidence;
rollback;
