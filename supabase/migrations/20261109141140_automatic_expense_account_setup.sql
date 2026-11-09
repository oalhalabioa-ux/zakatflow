-- Prepare operational expense classification/category with the account itself.
-- Policy approval continues through the existing audited approval command.
create function private.financial_prepare_expense_account()
returns trigger language plpgsql security definer set search_path='' as $$
declare
 classification uuid;
 classification_code text;
 policy record;
 source_rule jsonb;
 new_rule jsonb;
 draft public.financial_reporting_policies%rowtype;
begin
 if new.reporting_code <> '6100' then return new; end if;
 classification_code := 'OPEX_ACCOUNT_' || new.code;
 if not new.is_active or not new.is_postable or new.normal_side <> 'DEBIT' then
  -- Retain identifiers referenced by historical vouchers; hide them from new work.
  update public.liquidity_flow_categories category set active=false
   where category.organization_id=new.organization_id and category.code=classification_code
     and category.is_system and exists(select 1 from public.financial_classifications c
       where c.id=category.expense_classification_id and c.organization_id=new.organization_id
         and c.code=classification_code and c.classification_type='OPEX' and c.is_system);
  update public.financial_classifications set active=false
   where organization_id=new.organization_id and code=classification_code
     and classification_type='OPEX' and is_system;
  return new;
 end if;
 insert into public.financial_classifications
  (organization_id,code,name,classification_type,is_system,created_by,metadata)
 values(new.organization_id,classification_code,new.name_ar,'OPEX',true,auth.uid(),jsonb_build_object('automaticExpenseAccount',new.code))
 on conflict (organization_id,code) do nothing;
 select id into classification from public.financial_classifications
 where organization_id=new.organization_id and code=classification_code
   and classification_type='OPEX' and is_system;
 if classification is null then
  raise exception 'CHART_CLASSIFICATION_CONFLICT';
 end if;
 update public.financial_classifications set active=true,name=new.name_ar
  where id=classification and organization_id=new.organization_id;
 insert into public.liquidity_flow_categories
  (organization_id,code,name_ar,name_en,flow_group,allowed_direction,is_system,
   accounting_group,treatment_code,financial_classification_type,expense_classification_id)
 values(new.organization_id,classification_code,new.name_ar,new.name_en,'OPERATING','OUTFLOW',true,
   'EXPENSE','OPERATING_EXPENSE','OPEX',classification)
 on conflict (organization_id,code) do nothing;
 if not exists(select 1 from public.liquidity_flow_categories
   where organization_id=new.organization_id and code=classification_code
     and expense_classification_id=classification and is_system
     and financial_classification_type='OPEX') then
  raise exception 'CHART_CLASSIFICATION_CONFLICT';
 end if;
 update public.liquidity_flow_categories set active=true,name_ar=new.name_ar,name_en=new.name_en
  where organization_id=new.organization_id and code=classification_code
    and expense_classification_id=classification and is_system;
 -- Every open configured period gets a draft addition. Take the same policy
 -- lock as the save RPC and reread after locking, preserving concurrent edits.
 for policy in
  select distinct fiscal_start from public.financial_reporting_policies
  where organization_id=new.organization_id and status in ('DRAFT','APPROVED')
    and not exists(select 1 from public.financial_year_closures closed
      where closed.organization_id=new.organization_id
        and closed.fiscal_start=financial_reporting_policies.fiscal_start and closed.status='CLOSED')
  order by fiscal_start
 loop
  perform private.financial_assert_open_period(new.organization_id,policy.fiscal_start);
  perform pg_advisory_xact_lock(hashtextextended(
   'reporting-policy:'||new.organization_id::text||policy.fiscal_start::text,0));
  select * into draft from public.financial_reporting_policies
   where organization_id=new.organization_id and fiscal_start=policy.fiscal_start
     and status in ('DRAFT','APPROVED')
   order by (status='DRAFT') desc,version desc limit 1;
  if exists(select 1 from jsonb_array_elements(draft.rules) rule
    where rule->>'classificationId'=classification::text||':BASE'
      and rule->>'eventType'='EXPENSE'
      and rule->>'sourceModule'='OPERATIONAL_CONSOLE'
      and rule->>'cashDirection'='NON_CASH') then
   continue;
  end if;
  select rule into source_rule
   from jsonb_array_elements(draft.rules) rule
   join public.financial_classifications c
    on rule->>'classificationId'=c.id::text||':BASE'
   where c.organization_id=new.organization_id and c.code='OPEX'
     and rule->>'eventType'='EXPENSE'
     and rule->>'sourceModule'='OPERATIONAL_CONSOLE'
     and rule->>'cashDirection'='NON_CASH';
  if source_rule is not null then
   new_rule := source_rule || jsonb_build_object(
     'classificationId',classification::text||':BASE',
     'debitAccountId',new.code);
   perform public.save_financial_reporting_policy(new.organization_id,
    policy.fiscal_start,case when draft.status='DRAFT' then draft.version else 0 end,
    draft.rules||jsonb_build_array(new_rule),'Automatic expense account mapping '||new.code);
  end if;
 end loop;
 return new;
end;
$$;
revoke all on function private.financial_prepare_expense_account() from public,anon,authenticated;
create trigger financial_prepare_expense_account
 after insert or update of is_active,is_postable,normal_side,name_ar,name_en on public.financial_chart_custom_accounts
 for each row execute function private.financial_prepare_expense_account();
