-- New payments of a single manual Liquidity obligation reuse the recorded
-- payable leg. Historical resolutions and unrelated source adapters are untouched.
create function private.financial_resolve_manual_payment(p_org uuid,p_event jsonb,p_lines jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare
  payment_id uuid;
  origin_type text;
  origin_lines jsonb;
  origin_rules jsonb;
  activity text;
  allocation_amount numeric;
  payable_code text;
begin
  if p_event->>'eventType' is distinct from 'SETTLEMENT'
    or coalesce(p_event->>'id','') !~ '^[0-9a-f-]{36}$'
    or p_event->>'reversesEventId' is not null then
    return p_lines;
  end if;

  payment_id := (p_event->>'id')::uuid;
  select e.event_type, resolved.lines, policy.rules, allocation.base_amount
    into origin_type, origin_lines, origin_rules, allocation_amount
  from public.financial_event_obligation_allocations allocation
  join public.financial_event_obligations obligation
    on obligation.id=allocation.obligation_id and obligation.organization_id=allocation.organization_id
  join public.financial_events e
    on e.id=obligation.event_id and e.organization_id=obligation.organization_id
  join private.financial_event_posting_resolutions resolved
    on resolved.organization_id=e.organization_id and resolved.event_id=e.id::text
  join public.financial_reporting_policies policy
    on policy.id=resolved.policy_id and policy.organization_id=e.organization_id
  where allocation.organization_id=p_org and allocation.application_event_id=payment_id
    and allocation.allocation_type='PAYMENT' and obligation.obligation_type='PAYABLE'
    and exists (
      select 1 from public.financial_event_lines line
      join public.financial_classifications classification
        on classification.id=line.classification_id and classification.organization_id=line.organization_id
      where line.organization_id=p_org and line.event_id=e.id and (
        (e.event_type='EXPENSE' and classification.classification_type='OPEX') or
        (e.event_type='ASSET_PURCHASE' and classification.classification_type in ('CAPEX','INVESTMENT'))
      )
    )
    and e.source_module='OPERATIONAL_CONSOLE'
    and e.source_event_key='liquidity:'||e.source_record_id::text||':recognition'
    and private.financial_detailed_policy(policy.rules)
  limit 1;

  if not found then
    return p_lines;
  end if;

  -- The native manual path has one payable. Multi-obligation payments need
  -- explicit per-line allocation before they can inherit different accounts.
  if (select count(*) from public.financial_event_obligation_allocations
       where organization_id=p_org and application_event_id=payment_id)<>1
    or jsonb_array_length(origin_lines)<>1
    or origin_lines->0->>'cashDirection' is distinct from 'NON_CASH'
    or jsonb_array_length(p_lines)<>1
    or p_lines->0->>'cashDirection' is distinct from 'OUTFLOW'
    or allocation_amount is distinct from (p_event->'lines'->0->>'baseAmount')::numeric then
    raise exception 'REPORTING_PAYMENT_ALLOCATION_REQUIRED';
  end if;

  payable_code := origin_lines->0->>'creditAccountId';
  if not exists (
    select 1 from public.financial_chart_custom_accounts c
    where c.organization_id=p_org and c.code=payable_code
      and c.reporting_code='2100' and c.is_active and c.is_postable
      and not exists (
        select 1 from public.financial_chart_custom_accounts child
        where child.organization_id=p_org and child.parent_code=c.code
      )
  ) then
    raise exception 'REPORTING_PAYMENT_PAYABLE_ACCOUNT_REQUIRED';
  end if;

  -- Reuse the source classification's approved payment activity when it
  -- exists. Otherwise preserve the expense rule or use the purchase default.
  select rule->>'cashActivity' into activity
  from jsonb_array_elements(origin_rules) rule
  where rule->>'eventType'='SETTLEMENT' and rule->>'sourceModule'='OPERATIONAL_CONSOLE'
    and rule->>'classificationId'=origin_lines->0->>'classificationId'
    and rule->>'cashDirection'='OUTFLOW';
  return jsonb_build_array(p_lines->0||jsonb_build_object(
    'debitAccountId',payable_code,
    'cashActivity',coalesce(activity,case origin_type when 'ASSET_PURCHASE' then 'INVESTING' else p_lines->0->>'cashActivity' end)
  ));
end;
$$;
revoke all on function private.financial_resolve_manual_payment(uuid,jsonb,jsonb) from public,anon,authenticated;

-- Apply only when a new ACTUAL event is captured, not while backfilling a
-- policy history or replaying an already captured posting.
do $$
declare definition text;
  needle constant text := 'private.financial_resolve_event_posting(new.organization_id,ev,pol.id,pol.rules,true)';
begin
  definition := pg_get_functiondef('private.financial_capture_actual_posting()'::regprocedure);
  if strpos(definition,needle)=0 then
    raise exception 'REPORTING_ACTUAL_POSTING_SIGNATURE_CHANGED';
  end if;
  execute replace(definition,needle,
    'private.financial_resolve_manual_payment(new.organization_id,ev,'||needle||')');
end;
$$;
