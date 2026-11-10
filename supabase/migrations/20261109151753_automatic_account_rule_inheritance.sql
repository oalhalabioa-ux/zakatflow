-- Inherit existing source templates for every non-cash control group. No
-- financial amount, approved policy, closed period or source voucher is changed.
create function private.financial_inherit_account_rules(p_org uuid,p_code text)
returns integer language plpgsql security definer set search_path='' as $$
declare
 account public.financial_chart_custom_accounts%rowtype;
 policy record; draft public.financial_reporting_policies%rowtype;
 template record; classification uuid; classification_code text;
 debit_root text; credit_root text; new_rule jsonb; rules jsonb;
 modified boolean; added integer:=0; binding jsonb;
begin
 select * into account from public.financial_chart_custom_accounts
  where organization_id=p_org and code=p_code;
 if not found then raise exception 'CHART_ACCOUNT_NOT_FOUND';end if;
 -- Cash comes from the source bank; retained earnings comes from the fiscal
 -- settings. OPEX retains the existing category-integrated lifecycle trigger.
 if account.reporting_code in ('1000','3300','6100') then return 0;end if;
 if not account.is_active or not account.is_postable or account.normal_side<>(case
   when account.reporting_code in ('1590','2100','2200','2300','2400','2500','3100','3200','4100') then 'CREDIT' else 'DEBIT' end) then
  update public.liquidity_flow_categories category set active=false
   where category.organization_id=p_org and category.is_system and exists(
    select 1 from public.financial_classifications c where c.id=category.expense_classification_id
     and c.organization_id=p_org and c.metadata->'accountInheritance'->>'accountCode'=p_code);
  update public.financial_classifications set active=false
   where organization_id=p_org and is_system
     and metadata->'accountInheritance'->>'accountCode'=p_code;
  return 0;
 end if;
 update public.financial_classifications c set active=true,name=account.name_ar||' — '||base.name
  from public.financial_classifications base
  where c.organization_id=p_org and c.is_system
    and c.metadata->'accountInheritance'->>'accountCode'=p_code
    and base.organization_id=p_org and base.id::text=c.metadata->'accountInheritance'->>'baseClassificationId';
 update public.liquidity_flow_categories category set active=true,
  name_ar=left(account.name_ar,45)||' — '||left(base.name,32),
  name_en=left(account.name_en,45)||' — '||left(base.code,32)
  from public.financial_classifications c join public.financial_classifications base
    on base.organization_id=c.organization_id and base.id::text=c.metadata->'accountInheritance'->>'baseClassificationId'
  where category.organization_id=p_org and category.is_system
    and c.id=category.expense_classification_id and c.organization_id=p_org
    and c.metadata->'accountInheritance'->>'accountCode'=p_code;
 for policy in
  select distinct fiscal_start from public.financial_reporting_policies p
   where organization_id=p_org and status in ('DRAFT','APPROVED')
     and not exists(select 1 from public.financial_year_closures c
       where c.organization_id=p_org and c.fiscal_start=p.fiscal_start and c.status='CLOSED')
   order by fiscal_start
 loop
  perform private.financial_assert_open_period(p_org,policy.fiscal_start);
  perform pg_advisory_xact_lock(hashtextextended('reporting-policy:'||p_org::text||policy.fiscal_start::text,0));
  select * into draft from public.financial_reporting_policies
   where organization_id=p_org and fiscal_start=policy.fiscal_start and status in ('DRAFT','APPROVED')
   order by (status='DRAFT') desc,version desc limit 1;
  rules:=draft.rules;modified:=false;
  for template in
   select r.rule,c.id,c.code,c.name,c.classification_type
   from jsonb_array_elements(draft.rules) r(rule)
   join public.financial_classifications c
    on split_part(r.rule->>'classificationId',':',1)=c.id::text and c.organization_id=p_org
   where c.active and (c.is_system or c.code=c.classification_type)
     and not (c.metadata ? 'accountInheritance')
     and not (c.metadata ? 'automaticExpenseAccount')
     -- Existing lifecycle BASE conflates depreciation and disposal/sale losses.
     -- Do not propagate it until the source emits unambiguous roles.
     and not (r.rule->>'sourceModule'='ASSET_LIFECYCLE' and r.rule->>'eventType'='ADJUSTMENT'
       and r.rule->>'classificationId' like '%:BASE')
  loop
   select coalesce((select a.reporting_code from public.financial_chart_custom_accounts a
    where a.organization_id=p_org and a.code=template.rule->>'debitAccountId'),template.rule->>'debitAccountId') into debit_root;
   select coalesce((select a.reporting_code from public.financial_chart_custom_accounts a
    where a.organization_id=p_org and a.code=template.rule->>'creditAccountId'),template.rule->>'creditAccountId') into credit_root;
   if (debit_root=account.reporting_code)=(credit_root=account.reporting_code) then continue;end if;
   classification_code:=template.code||'_ACCOUNT_'||p_code;
   binding:=jsonb_build_object('accountCode',p_code,'reportingCode',account.reporting_code,'baseClassificationId',template.id);
   insert into public.financial_classifications(organization_id,code,name,classification_type,is_system,metadata,created_by)
    values(p_org,classification_code,account.name_ar||' — '||template.name,template.classification_type,true,jsonb_build_object('accountInheritance',binding),auth.uid())
    on conflict(organization_id,code) do nothing;
   select id into classification from public.financial_classifications
    where organization_id=p_org and code=classification_code and is_system
      and classification_type=template.classification_type and metadata->'accountInheritance'=binding;
   if classification is null then raise exception 'CHART_CLASSIFICATION_CONFLICT';end if;
   new_rule:=template.rule||jsonb_build_object('classificationId',classification::text||substring(template.rule->>'classificationId' from length(template.id::text)+1))
    ||case when debit_root=account.reporting_code then jsonb_build_object('debitAccountId',p_code) else jsonb_build_object('creditAccountId',p_code) end;
   -- Primary recognition categories are immediately usable in Liquidity.
   -- Counterpart-only links (receivables/payables/VAT controls) remain on the
   -- native source and settlement path rather than masquerading as expenses.
   if template.rule->>'sourceModule'='OPERATIONAL_CONSOLE'
     and template.rule->>'cashDirection'='NON_CASH'
     and account.reporting_code in ('1500','1600','4100','5100','7100','8100')
     and template.classification_type in ('REVENUE','OPEX','CAPEX','ASSET','INVESTMENT','TAX','ZAKAT') then
    insert into public.liquidity_flow_categories
     (organization_id,code,name_ar,name_en,flow_group,allowed_direction,is_system,
      accounting_group,treatment_code,financial_classification_type,expense_classification_id)
    values(p_org,classification_code,left(account.name_ar,45)||' — '||left(template.name,32),left(account.name_en,45)||' — '||left(template.code,32),
     case when template.classification_type in ('CAPEX','ASSET','INVESTMENT') then 'INVESTMENT'
      when template.classification_type in ('TAX','ZAKAT') then 'TAX' else 'OPERATING' end,
     case when template.classification_type='REVENUE' then 'INFLOW' else 'OUTFLOW' end,true,
     case template.classification_type when 'CAPEX' then 'ASSETS' when 'ASSET' then 'ASSETS'
      when 'INVESTMENT' then 'INVESTMENTS' when 'OPEX' then 'EXPENSE' else template.classification_type end,
     case template.classification_type when 'REVENUE' then 'OTHER_REVENUE' when 'CAPEX' then 'CAPITAL_PROJECT'
      when 'ASSET' then 'FIXED_ASSET_PURCHASE' when 'INVESTMENT' then 'FINANCIAL_INVESTMENT'
      when 'OPEX' then 'OPERATING_EXPENSE' when 'ZAKAT' then 'ZAKAT_ACCRUAL' else 'OTHER_TAX' end,
     template.classification_type,classification)
    on conflict(organization_id,code) do nothing;
    if not exists(select 1 from public.liquidity_flow_categories where organization_id=p_org
     and code=classification_code and is_system and expense_classification_id=classification
     and financial_classification_type=template.classification_type) then raise exception 'CHART_CLASSIFICATION_CONFLICT';end if;
   end if;
   -- Existing edited rules always win, even when a base template changes.
   if not exists(select 1 from jsonb_array_elements(rules) r
     where r->>'classificationId'=new_rule->>'classificationId'
      and r->>'eventType'=new_rule->>'eventType' and r->>'sourceModule'=new_rule->>'sourceModule'
      and r->>'cashDirection'=new_rule->>'cashDirection') then
    rules:=rules||jsonb_build_array(new_rule);modified:=true;added:=added+1;
   end if;
  end loop;
  if modified then
   perform public.save_financial_reporting_policy(p_org,policy.fiscal_start,
    case when draft.status='DRAFT' then draft.version else 0 end,rules,'Automatic child account rules '||p_code);
  end if;
 end loop;
 return added;
end;
$$;
revoke all on function private.financial_inherit_account_rules(uuid,text) from public,anon,authenticated;

create function private.financial_account_rule_inheritance_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform private.financial_inherit_account_rules(new.organization_id,new.code);
 return new;
end;
$$;
revoke all on function private.financial_account_rule_inheritance_trigger() from public,anon,authenticated;
create trigger financial_account_rule_inheritance
 after insert or update of is_active,is_postable,normal_side,name_ar,name_en on public.financial_chart_custom_accounts
 for each row execute function private.financial_account_rule_inheritance_trigger();

-- Explicit reconciliation also covers accounts created before these triggers.
create function public.prepare_financial_account_rule_links(p_org uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare account record; added integer:=0;
begin
 if not private.financial_opening_can(p_org,'financial_core.create') then raise exception 'CHART_WRITE_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended('chart-accounts:'||p_org::text,0));
 for account in select code,reporting_code from public.financial_chart_custom_accounts where organization_id=p_org order by code loop
  if account.reporting_code='6100' then
   update public.financial_chart_custom_accounts set is_active=is_active where organization_id=p_org and code=account.code;
  else
   added:=added+private.financial_inherit_account_rules(p_org,account.code);
  end if;
 end loop;
 return jsonb_build_object('addedRules',added);
end;
$$;
revoke all on function public.prepare_financial_account_rule_links(uuid) from public,anon;
grant execute on function public.prepare_financial_account_rule_links(uuid) to authenticated;

-- Legacy source factories choose a generic classification. Account-specific
-- choices are explicit and must never become a LIMIT 1 fallback in those paths.
do $$
declare f record;definition text;
begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname in
   ('prepare_asset_lifecycle','create_asset_with_acquisition','purchase_existing_asset',
    'amend_zatca_draft_atomic','amend_unissued_sales_invoice','amend_unsettled_purchase_invoice',
    'prepare_vat_financial_event','prepare_vat_note_financial_event','create_debt_contract','prepare_debt_operation')
 loop
  definition:=pg_get_functiondef(f.oid);
  if definition ~* 'from[[:space:]]+public\.financial_classifications[[:space:]]+where' then
   execute regexp_replace(definition,
    'from[[:space:]]+public\.financial_classifications[[:space:]]+where',
    'from (select * from public.financial_classifications where not (metadata ? ''accountInheritance'') and not (metadata ? ''automaticExpenseAccount'')) financial_classifications where','gi');
  end if;
 end loop;
end;
$$;
notify pgrst,'reload schema';

-- BEGIN INHERITED SETTLEMENT RESOLVER
-- New payments of a single manual Liquidity obligation reuse the recorded
-- payable leg. Historical resolutions and unrelated source adapters are untouched.
create or replace function private.financial_resolve_manual_payment(p_org uuid,p_event jsonb,p_lines jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare
  payment_id uuid;
  origin_type text;
  origin_lines jsonb;
  origin_rules jsonb;
  activity text;
  allocation_amount numeric;
  payable_code text;
  obligation_side text;
  expected_direction text;
begin
  if p_event->>'eventType' is distinct from 'SETTLEMENT'
    or coalesce(p_event->>'id','') !~ '^[0-9a-f-]{36}$'
    or p_event->>'reversesEventId' is not null then
    return p_lines;
  end if;

  payment_id := (p_event->>'id')::uuid;
  select e.event_type, resolved.lines, policy.rules, allocation.base_amount, obligation.obligation_type
    into origin_type, origin_lines, origin_rules, allocation_amount, obligation_side
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
    and allocation.allocation_type='PAYMENT' and obligation.obligation_type in ('PAYABLE','RECEIVABLE')
    and exists (
      select 1 from public.financial_event_lines line
      join public.financial_classifications classification
        on classification.id=line.classification_id and classification.organization_id=line.organization_id
      where line.organization_id=p_org and line.event_id=e.id and (
        (e.event_type='EXPENSE' and classification.classification_type in ('OPEX','TAX','ZAKAT')) or
        (e.event_type='ASSET_PURCHASE' and classification.classification_type in ('CAPEX','ASSET','INVESTMENT')) or
        (e.event_type='REVENUE' and classification.classification_type='REVENUE')
      )
    )
    and e.source_module='OPERATIONAL_CONSOLE'
    and e.source_event_key='liquidity:'||e.source_record_id::text||':recognition'
    and private.financial_detailed_policy(policy.rules)
  limit 1;

  if not found then
    return p_lines;
  end if;

  expected_direction:=case when obligation_side='RECEIVABLE' then 'INFLOW' else 'OUTFLOW' end;
  -- The native manual path has one obligation. Multi-obligation payments need
  -- explicit per-line allocation before they can inherit different accounts.
  if (select count(*) from public.financial_event_obligation_allocations
       where organization_id=p_org and application_event_id=payment_id)<>1
    or jsonb_array_length(origin_lines)<>1
    or origin_lines->0->>'cashDirection' is distinct from 'NON_CASH'
    or jsonb_array_length(p_lines)<>1
    or p_lines->0->>'cashDirection' is distinct from expected_direction
    or allocation_amount is distinct from (p_event->'lines'->0->>'baseAmount')::numeric then
    raise exception 'REPORTING_PAYMENT_ALLOCATION_REQUIRED';
  end if;

  payable_code := origin_lines->0->>(case when obligation_side='RECEIVABLE' then 'debitAccountId' else 'creditAccountId' end);
  if not exists (
    select 1 from public.financial_chart_custom_accounts c
    where c.organization_id=p_org and c.code=payable_code
      and ((obligation_side='PAYABLE' and c.reporting_code in ('2100','2200','2300','2400','2500'))
        or (obligation_side='RECEIVABLE' and c.reporting_code in ('1100','1200','1300','1400','1800'))) and c.is_active and c.is_postable
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
    and rule->>'cashDirection'=expected_direction;
  return jsonb_build_array(p_lines->0||jsonb_build_object(
    case when obligation_side='RECEIVABLE' then 'creditAccountId' else 'debitAccountId' end,payable_code,
    'cashActivity',coalesce(activity,case origin_type when 'ASSET_PURCHASE' then 'INVESTING' else p_lines->0->>'cashActivity' end)
  ));
end;
$$;
revoke all on function private.financial_resolve_manual_payment(uuid,jsonb,jsonb) from public,anon,authenticated;

-- END INHERITED SETTLEMENT RESOLVER

-- The legacy column name is retained for compatibility with saved categories.
-- Its linked classification can now be any supported primary recognition type.
create or replace function private.validate_liquidity_expense_classification()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.expense_classification_id is not null and (
  new.financial_classification_type is null
  or new.financial_classification_type not in ('OPEX','REVENUE','CAPEX','ASSET','INVESTMENT','TAX','ZAKAT')
  or not exists(select 1 from public.financial_classifications c
   where c.id=new.expense_classification_id and c.organization_id=new.organization_id
    and c.classification_type=new.financial_classification_type and c.active)
 ) then raise exception 'LIQUIDITY_EXPENSE_CLASSIFICATION_INVALID';end if;
 return new;
end;
$$;
revoke all on function private.validate_liquidity_expense_classification() from public,anon,authenticated;
