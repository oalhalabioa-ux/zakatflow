-- Disposable cutoff and maturity acceptance over native institutional posting.
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
  purchase_payload jsonb;
  payment_payload jsonb;
  allocations jsonb;
  payment_id uuid;
  reversal_id uuid;
  settlement_id uuid;
  terms jsonb;
  proof jsonb;
  maturity jsonb;
  opening_credit jsonb;
  cutoff_cases jsonb:='[]';
  day date;
  other_purchase jsonb;
  payment numeric;
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
    (select jsonb_agg(jsonb_build_object('kind','INSTALLMENT','due_date',(date '2026-03-01'+make_interval(months=>case when n<6 then n else n+12 end))::date,'principal','8000') order by n)
     from generate_series(0,9) n));
  purchase := public.create_scheduled_supplier_asset(purchase_payload,gen_random_uuid(),terms);
  purchase_event_id := (purchase->>'financial_event_id')::uuid;
  proof:=public.read_asset_supplier_schedule((purchase->>'id')::uuid);
  maturity:=public.read_asset_supplier_maturity_at_cutoff(org,(proof->>'obligation_id')::uuid,'2026-02-01','2027-02-01');
  assert maturity->>'status'='NOT_OUTSTANDING';
  assert maturity->>'outstanding' is null;

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

  foreach payment in array array[36000,64000] loop
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
  end loop;

  select id into strict settlement_id from public.liquidity_settlements where financial_event_id=payment_id;
  reversal_id:=public.create_financial_event_command(payment_payload||jsonb_build_object(
    'event_type','REVERSAL','source_event_key','qa-asset-funding-reverse:'||gen_random_uuid(),'event_date','2026-03-02',
    'lines',jsonb_build_array((payment_payload->'lines'->0)||jsonb_build_object('cash_direction','INFLOW')),
    'links',jsonb_build_array(jsonb_build_object('link_type','REVERSAL_OF','related_event_id',payment_id))));
  perform public.transition_financial_event(reversal_id,'PLANNED','QA');
  perform public.transition_financial_event(reversal_id,'COMMITTED','QA');
  perform public.approve_financial_event(reversal_id,'QA');
  perform public.reverse_financial_settlement(settlement_id,reversal_id,'Reverse the last synthetic payment');
  foreach day in array array[date '2026-01-31',date '2026-02-01',date '2026-03-01',date '2026-03-02'] loop
    maturity:=public.read_asset_supplier_maturity_at_cutoff(org,purchase_obligation_id,day,(day+interval '1 year')::date);
    if day='2026-01-31' then
      assert maturity->>'status'='NOT_OUTSTANDING';
    else
      assert maturity->>'status'='VERIFIED';
      assert (maturity->>'outstanding')::numeric=(case day
        when date '2026-02-01' then 100000 when date '2026-03-01' then 0 else 64000 end);
      assert (maturity->>'due_within_horizon')::numeric=(case day
        when date '2026-02-01' then 68000 when date '2026-03-01' then 0 else 32000 end);
      assert (maturity->>'due_after_horizon')::numeric=(case when day='2026-03-01' then 0 else 32000 end);
      execute 'reset role';
      select r into opening_credit from jsonb_array_elements(private.financial_opening_sources(org,day)->'rows') r
        where r->>'id'='debt:'||purchase_obligation_id::text;
      execute 'set local role authenticated';
      assert coalesce((opening_credit#>>'{vouchers,0,credit}')::numeric,0)=(maturity->>'outstanding')::numeric;
    end if;
    cutoff_cases:=cutoff_cases||jsonb_build_array(jsonb_build_object('date',day,'status',maturity->>'status',
      'outstanding',maturity->>'outstanding','current',maturity->>'due_within_horizon','non_current',maturity->>'due_after_horizon'));
  end loop;

  maturity:=public.read_asset_supplier_maturity_at_cutoff(org,purchase_obligation_id,'2026-08-02','2026-08-02');
  assert (maturity->>'overdue')::numeric=32000 and (maturity->>'due_within_horizon')::numeric=32000;
  assert public.read_asset_supplier_maturity_at_cutoff(org,gen_random_uuid(),'2026-03-01','2027-03-01') is null;
  begin
    perform public.read_asset_supplier_maturity_at_cutoff(org,purchase_obligation_id,'2026-03-01','2026-02-01');
    raise exception 'Invalid horizon accepted';
  exception when others then
    if sqlerrm<>'ASSET_SUPPLIER_MATURITY_INVALID' then raise; end if;
  end;

  -- Direct asset reversal in the legacy FC V2 path lacks a dated contra-event.
  other_purchase:=public.create_scheduled_supplier_asset(
    jsonb_set(purchase_payload,'{metadata,invoice_reference}','"MATURITY-UNLINKED-REVERSE"'),
    gen_random_uuid(),terms);
  purchase_event_id:=(other_purchase->>'financial_event_id')::uuid;
  proof:=public.read_asset_supplier_schedule((other_purchase->>'id')::uuid);
  perform public.transition_financial_event(purchase_event_id,'PLANNED','QA');
  perform public.transition_financial_event(purchase_event_id,'COMMITTED','QA');
  perform public.approve_financial_event(purchase_event_id,'QA');
  perform public.transition_financial_event(purchase_event_id,'ACTUAL','QA');
  perform public.reverse_asset_financial_event(purchase_event_id,'Synthetic unlinked acquisition reversal');
  maturity:=public.read_asset_supplier_maturity_at_cutoff(org,(proof->>'obligation_id')::uuid,'2026-03-01','2027-03-01');
  assert maturity->>'status'='REVIEW_REQUIRED' and maturity->>'reason'='REVERSAL_DATE_UNPROVEN';
  assert maturity->>'outstanding' is null;

  perform set_config('request.jwt.claim.sub',other_actor::text,true);
  begin
    perform public.read_asset_supplier_maturity_at_cutoff(org,purchase_obligation_id,'2026-03-01','2027-03-01');
    raise exception 'Foreign maturity request accepted';
  exception when others then
    if sqlerrm<>'ASSET_SUPPLIER_MATURITY_DENIED' then raise;end if;
  end;
  assert not has_function_privilege('anon','public.read_asset_supplier_maturity_at_cutoff(uuid,uuid,date,date)','execute');
  perform set_config('qa.asset_funding_result',jsonb_build_object(
    'cutoffs',cutoff_cases,'nativeOpeningMatched',true,'unlinkedReversalFailsClosed',true,'ownerIsolation',true)::text,true);
end
$$;
select current_setting('qa.asset_funding_result')::jsonb as acceptance;
rollback;
