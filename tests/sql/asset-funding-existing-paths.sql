-- Disposable full-schema acceptance for the two existing writers used by the funding UI.
begin;
set local plpgsql.check_asserts = on;
do $$
declare
  actor uuid := gen_random_uuid();
  other_actor uuid := gen_random_uuid();
  org uuid := gen_random_uuid();
  bank uuid;
  supplier uuid;
  settlement_category uuid;
  cash jsonb;
  personal_asset jsonb;
  purchase jsonb;
  movement jsonb;
  purchase_event_id uuid;
  purchase_obligation_id uuid;
  flow_id uuid;
  request_id uuid := gen_random_uuid();
  purchase_payload jsonb;
  payment_payload jsonb;
  allocations jsonb;
  payment_id uuid;
  payment numeric;
  paid numeric := 0;
  deferred_cost constant numeric := 100000;
  opening_bank constant numeric := 150000;
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (actor,actor||'@funding-qa.invalid',now()),
    (other_actor,other_actor||'@funding-qa.invalid',now());
  update public.profiles set base_currency='SAR' where id in(actor,other_actor);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  insert into public.organizations(id,owner_user_id,name,base_currency,approval_policy)
    values(org,actor,'Synthetic asset funding','SAR','OWNER_CONTROLLED');
  insert into public.organization_members(organization_id,user_id,role,status)
    values(org,actor,'OWNER','ACTIVE') on conflict do nothing;
  insert into public.liquidity_counterparties(organization_id,name,party_type,created_by)
    values(org,'Synthetic equipment supplier','SUPPLIER',actor) returning id into supplier;
  insert into public.financial_classifications(organization_id,code,name,classification_type,created_by)
    values(org,'FUNDING_ASSET_QA','Synthetic capex','CAPEX',actor);
  insert into public.financial_classifications(organization_id,code,name,classification_type,created_by)
    values(org,'FUNDING_PAYABLE_QA','Synthetic supplier payable','PAYABLE',actor)
    returning id into settlement_category;
  set local role authenticated;

  cash := public.create_asset_with_acquisition(jsonb_build_object(
    'asset_type','BANK','name','Synthetic personal bank','currency','SAR','ownership_scope','PERSONAL',
    'metadata',jsonb_build_object('quantity',opening_bank,'purchase_value',opening_bank,
      'purchase_date','2026-01-01','acquisition_mode','OPENING_BALANCE')),gen_random_uuid());
  purchase_payload := jsonb_build_object('asset_type','OTHER','name','Synthetic cash vehicle',
    'currency','SAR','ownership_scope','PERSONAL','is_zakatable',false,'metadata',
    jsonb_build_object('purchase_value',deferred_cost,'purchase_date','2026-02-01',
      'acquisition_mode','PURCHASE','vat_amount',0,'funding_account_id',cash->>'id'));
  personal_asset := public.create_asset_with_acquisition(purchase_payload,request_id);
  assert (public.create_asset_with_acquisition(purchase_payload,request_id)->>'id')=personal_asset->>'id';
  select to_jsonb(t) into strict purchase from public.transactions t where
    t.asset_account_id=(personal_asset->>'id')::uuid and t.transaction_type='PURCHASE'
    and t.metadata->>'acquisition_request_id'=request_id::text;
  select to_jsonb(t) into strict movement from public.transactions t where
    t.id=(purchase#>>'{metadata,purchase_funding,withdrawal_id}')::uuid and t.user_id=actor
    and t.organization_id is null and t.transaction_type='WITHDRAWAL'
    and t.metadata->>'purchase_transaction_id'=purchase->>'id';
  assert (movement#>>'{metadata,purchase_funding,payment_amount}')::numeric=deferred_cost;
  assert (select sum(remaining_value_base) from public.lots where asset_account_id=(cash->>'id')::uuid)
    =opening_bank-deferred_cost;
  perform set_config('request.jwt.claim.sub',other_actor::text,true);
  assert not exists(select 1 from public.transactions where id=(movement->>'id')::uuid);
  perform set_config('request.jwt.claim.sub',actor::text,true);

  bank := (public.open_financial_account(jsonb_build_object('request_id',gen_random_uuid(),
    'scope','ORGANIZATION','organization_id',org,'type','BANK','name','Synthetic corporate bank',
    'currency','SAR','opening_balance',opening_bank,'opening_date','2026-01-01','fx_rate',1))->>'id')::uuid;
  purchase_payload := jsonb_build_object('asset_type','OTHER','asset_class_code','PPE','asset_type_code','MACHINERY',
    'name','Synthetic deferred equipment','currency','SAR','ownership_scope','ORGANIZATION','organization_id',org,
    'metadata',jsonb_build_object('purchase_value',deferred_cost,'purchase_date','2026-02-01',
      'acquisition_mode','PURCHASE','vat_amount',0,'counterparty_id',supplier,
      'invoice_reference','FUNDING-QA','due_date','2026-03-01'));
  request_id := gen_random_uuid();
  purchase := public.create_asset_with_acquisition(purchase_payload,request_id);
  purchase_event_id := (purchase->>'financial_event_id')::uuid;
  assert (public.create_asset_with_acquisition(purchase_payload,request_id)->>'id')=purchase->>'id';
  assert (select current_balance from public.liquidity_accounts where id=bank)=opening_bank;
  perform public.transition_financial_event(purchase_event_id,'PLANNED','QA');
  perform public.transition_financial_event(purchase_event_id,'COMMITTED','QA');
  perform public.approve_financial_event(purchase_event_id,'QA');
  perform public.transition_financial_event(purchase_event_id,'ACTUAL','QA');
  select id into strict purchase_obligation_id from public.financial_event_obligations where financial_event_obligations.event_id=purchase_event_id;
  select target_record_id into strict flow_id from public.financial_event_links
    where financial_event_links.event_id=purchase_event_id and link_type='CASH_FLOW';
  assert (select outstanding_base_amount from public.financial_event_obligation_balances v
    where v.obligation_id=purchase_obligation_id)=deferred_cost;
  assert (select current_balance from public.liquidity_accounts where id=bank)=opening_bank;

  foreach payment in array array[20000,8000,8000,64000] loop
    payment_payload := jsonb_build_object('organization_id',org,'entity_id',null,'counterparty_id',supplier,
      'event_type','SETTLEMENT','source_module','OPERATIONAL_CONSOLE','source_event_key','qa-asset-funding:'||gen_random_uuid(),
      'event_date','2026-03-01','due_date',null,'base_currency','SAR','description','Synthetic supplier settlement',
      'lines',jsonb_build_array(jsonb_build_object('line_number',1,'classification_id',settlement_category,
        'description','Supplier settlement','amount',payment,'currency','SAR','exchange_rate',1,'base_amount',payment,
        'cash_direction','OUTFLOW','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0)),
      'obligations','[]'::jsonb,'links',jsonb_build_array(jsonb_build_object('link_type','SETTLEMENT_OF','related_event_id',purchase_event_id)));
    payment_id := public.create_financial_event_command(payment_payload);
    perform public.transition_financial_event(payment_id,'PLANNED','QA');
    perform public.transition_financial_event(payment_id,'COMMITTED','QA');
    perform public.approve_financial_event(payment_id,'QA');
    allocations := jsonb_build_array(jsonb_build_object('obligation_id',purchase_obligation_id,'flow_id',flow_id,
      'amount',payment,'base_amount',payment,'flow_amount',payment,'flow_currency','SAR','flow_exchange_rate',1));
    perform public.post_financial_settlement(payment_id,bank,'OUTFLOW','2026-03-01',payment,'SAR',1,payment,allocations);
    perform public.post_financial_settlement(payment_id,bank,'OUTFLOW','2026-03-01',payment,'SAR',1,payment,allocations);
    paid := paid + payment;
    assert (select settled_amount from public.liquidity_flows where id=flow_id)=paid;
    assert (select outstanding_base_amount from public.financial_event_obligation_balances v
      where v.obligation_id=purchase_obligation_id)=deferred_cost-paid;
    assert (select sum(remaining_value_base) from public.lots where asset_account_id=(purchase->>'id')::uuid)=deferred_cost;
    assert (select current_balance from public.liquidity_accounts where id=bank)=opening_bank-paid;
  end loop;
  perform set_config('request.jwt.claim.sub',other_actor::text,true);
  assert not exists(select 1 from public.liquidity_flows where id=flow_id);
  perform set_config('qa.asset_funding_result',jsonb_build_object(
    'personalCashPaid',deferred_cost,'institutionalAssetCost',deferred_cost,
    'institutionalOpeningCash',opening_bank,'institutionalSettlements',jsonb_build_array(20000,8000,8000,64000),
    'institutionalOutstanding',deferred_cost-paid,'institutionalCash',opening_bank-paid,
    'replayAndOwnerIsolation',true)::text,true);
end
$$;
select current_setting('qa.asset_funding_result')::jsonb as acceptance;
rollback;
