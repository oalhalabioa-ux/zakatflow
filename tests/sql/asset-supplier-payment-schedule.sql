-- Disposable full-schema acceptance for the scheduled institutional purchase and source settlements.
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
  purchase jsonb;
  purchase_event_id uuid;
  purchase_obligation_id uuid;
  flow_id uuid;
  request_id uuid := gen_random_uuid();
  purchase_payload jsonb;
  payment_payload jsonb;
  allocations jsonb;
  payment_id uuid;
  reversal_id uuid;
  settlement_id uuid;
  terms jsonb;
  proof jsonb;
  counts integer;
  reversal jsonb;
  replay jsonb;
  other_purchase jsonb;
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
  insert into public.financial_classifications(organization_id,code,name,classification_type,created_by)
    values(org,'FUNDING_VAT_QA','Synthetic recoverable VAT','TAX',actor);
  set local role authenticated;

  bank := (public.open_financial_account(jsonb_build_object('request_id',gen_random_uuid(),
    'scope','ORGANIZATION','organization_id',org,'type','BANK','name','Synthetic corporate bank',
    'currency','SAR','opening_balance',opening_bank,'opening_date','2026-01-01','fx_rate',1))->>'id')::uuid;
  purchase_payload := jsonb_build_object('asset_type','OTHER','asset_class_code','PPE','asset_type_code','MACHINERY',
    'name','Synthetic deferred equipment','currency','SAR','ownership_scope','ORGANIZATION','organization_id',org,
    'metadata',jsonb_build_object('purchase_value',deferred_cost,'purchase_date','2026-02-01',
      'acquisition_mode','PURCHASE','vat_amount',0,'counterparty_id',supplier,
      'invoice_reference','FUNDING-QA','due_date','2026-03-01'));
  terms:=jsonb_build_object('mode','INSTALLMENTS','entries',jsonb_build_array(
    jsonb_build_object('kind','DOWN_PAYMENT','due_date','2026-02-01','principal','20000'))||
    (select jsonb_agg(jsonb_build_object('kind','INSTALLMENT','due_date',(date '2026-03-01'+make_interval(months=>n))::date,'principal','8000') order by n)
     from generate_series(0,9) n));
  select count(*) into counts from public.asset_accounts where organization_id=org;
  begin
    perform public.create_scheduled_supplier_asset(purchase_payload,gen_random_uuid(),jsonb_set(terms,'{entries,2,principal}','"8001"'));
    raise exception 'Invalid schedule posted';
  exception when others then
    if sqlerrm<>'ASSET_SUPPLIER_SCHEDULE_TOTAL_MISMATCH' then raise;end if;
  end;
  assert (select count(*) from public.asset_accounts where organization_id=org)=counts;
  assert not exists(select 1 from public.financial_events where organization_id=org and source_module='ASSETS_INTEGRATION');
  request_id := gen_random_uuid();
  purchase := public.create_scheduled_supplier_asset(purchase_payload,request_id,terms);
  purchase_event_id := (purchase->>'financial_event_id')::uuid;
  assert purchase_event_id is not null;
  assert (public.create_scheduled_supplier_asset(purchase_payload,request_id,terms)->>'financial_event_id')=purchase_event_id::text;
  begin
    perform public.create_scheduled_supplier_asset(purchase_payload,request_id,jsonb_set(terms,'{entries,2,principal}','"8001"'));
    raise exception 'Altered retry accepted';
  exception when others then
    if sqlerrm<>'ASSET_SUPPLIER_SCHEDULE_CONFLICT' then raise;end if;
  end;
  assert (select current_balance from public.liquidity_accounts where id=bank)=opening_bank;
  proof:=public.read_asset_supplier_schedule((purchase->>'id')::uuid);
  assert proof->>'status'='DRAFT' and proof->>'remaining' is null and jsonb_array_length(proof->'entries')=11;
  assert proof->>'purchase_id'=purchase->>'acquisition_transaction_id';
  begin
    perform public.amend_asset_purchase_draft((purchase->>'id')::uuid,
      jsonb_build_object('purchase_value',101000,'quantity',1,'vat_input_mode','AMOUNT','recoverable_percent',100),
      (purchase->>'updated_at')::timestamptz);
    raise exception 'Draft total changed without a corresponding schedule';
  exception when others then
    if sqlerrm<>'ASSET_SUPPLIER_SCHEDULE_REQUIRES_RECONCILIATION' then raise;end if;
  end;
  assert (public.read_asset_supplier_schedule((purchase->>'id')::uuid)->>'document_total')::numeric=100000;
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
    proof:=public.read_asset_supplier_schedule((purchase->>'id')::uuid);
    assert proof->>'native_forecast_id'=flow_id::text and proof->>'obligation_id'=purchase_obligation_id::text;
    assert (proof->>'applied')::numeric=paid and (proof->>'remaining')::numeric=deferred_cost-paid;
    assert (select sum((x->>'remaining')::numeric) from jsonb_array_elements(proof->'entries') x)=deferred_cost-paid;
    assert not exists(select 1 from jsonb_array_elements(proof->'applications') a
      where a->>'settlement_id' is null or a->>'allocation_id' is null);
    if paid=28000 then assert (proof#>>'{entries,1,applied}')::numeric=8000; end if;
    if paid=36000 then assert (proof#>>'{entries,2,remaining}')::numeric=0; end if;

  end loop;

  select id into strict settlement_id from public.liquidity_settlements where financial_event_id=payment_id;
  reversal_id:=public.create_financial_event_command(payment_payload||jsonb_build_object(
    'event_type','REVERSAL','source_event_key','qa-asset-funding-reverse:'||gen_random_uuid(),'event_date','2026-03-02',
    'lines',jsonb_build_array((payment_payload->'lines'->0)||jsonb_build_object('cash_direction','INFLOW')),
    'links',jsonb_build_array(jsonb_build_object('link_type','REVERSAL_OF','related_event_id',payment_id))));
  perform public.transition_financial_event(reversal_id,'PLANNED','QA');
  perform public.transition_financial_event(reversal_id,'COMMITTED','QA');
  perform public.approve_financial_event(reversal_id,'QA');
  reversal:=public.reverse_financial_settlement(settlement_id,reversal_id,'Reverse the last synthetic payment');
  replay:=public.reverse_financial_settlement(settlement_id,reversal_id,'Reverse the last synthetic payment');
  assert replay->>'liquidity_settlement_id'=reversal->>'reversal_settlement_id', 'reversal retry did not resolve to the recorded settlement';
  proof:=public.read_asset_supplier_schedule((purchase->>'id')::uuid);
  assert (proof->>'remaining')::numeric=64000 and (proof->>'applied')::numeric=36000, 'reversal must reopen installments';
  assert (proof#>>'{entries,3,remaining}')::numeric=8000;
  assert (select current_balance from public.liquidity_accounts where id=bank)=opening_bank-36000;
  assert (select sum(remaining_value_base) from public.lots where asset_account_id=(purchase->>'id')::uuid)=deferred_cost;
  assert exists(select 1 from jsonb_array_elements(proof->'applications') a where a->>'event_status'='REVERSED' and a->>'reversal_settlement_id'=reversal->>'reversal_settlement_id');

  -- Credit purchase with no initial payment and recoverable VAT.
  other_purchase:=public.create_scheduled_supplier_asset(
    jsonb_set(jsonb_set(purchase_payload,'{metadata,invoice_reference}','"FUNDING-VAT-QA"'),
      '{metadata,vat_amount}','15000'),
    gen_random_uuid(),jsonb_build_object('mode','DEFERRED','entries',jsonb_build_array(
      jsonb_build_object('kind','INSTALLMENT','due_date','2026-03-01','principal','115000'))));
  proof:=public.read_asset_supplier_schedule((other_purchase->>'id')::uuid);
  assert (proof->>'document_total')::numeric=115000
    and (proof->>'invoice_net')::numeric=100000 and (proof->>'vat_total')::numeric=15000
    and (proof->>'asset_cost')::numeric=100000;
  assert (select sum(original_value_base) from public.lots where asset_account_id=(other_purchase->>'id')::uuid)=100000;
  assert (select current_balance from public.liquidity_accounts where id=bank)=opening_bank-36000;

  perform set_config('request.jwt.claim.sub',other_actor::text,true);
  begin
    perform public.read_asset_supplier_schedule((purchase->>'id')::uuid);
    raise exception 'Foreign owner read accepted';
  exception when others then
    if sqlerrm<>'ASSET_SUPPLIER_SCHEDULE_DENIED' then raise;end if;
  end;

  assert not exists(select 1 from public.liquidity_flows where id=flow_id);
  perform set_config('qa.asset_funding_result',jsonb_build_object(
    'institutionalAssetCost',deferred_cost,'reversedBalance',64000,
    'institutionalOpeningCash',opening_bank,'institutionalSettlements',jsonb_build_array(20000,8000,8000,64000),
    'institutionalOutstanding',deferred_cost-paid,'institutionalCash',opening_bank-paid,
    'replayAndOwnerIsolation',true)::text,true);
end
$$;
select current_setting('qa.asset_funding_result')::jsonb as acceptance;
rollback;
