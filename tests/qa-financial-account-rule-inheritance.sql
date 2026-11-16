-- Disposable full-schema runner only. Real RPCs and triggers, transaction rollback.
begin;
do $$
declare
 owner_id uuid:=gen_random_uuid();org uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();
 revenue uuid;child_id uuid;saved jsonb;before_rules jsonb;after_rules jsonb;v integer;
begin
 insert into auth.users(id,email,email_confirmed_at) values(owner_id,owner_id||'@inheritance.invalid',now()),(outsider,outsider||'@inheritance.invalid',now());
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 insert into public.organizations(id,owner_user_id,name) values(org,owner_id,'Rollback account inheritance fixture');
 insert into public.organization_members(organization_id,user_id,role,status) values(org,owner_id,'OWNER','ACTIVE') on conflict do nothing;
 insert into public.financial_classifications(organization_id,code,name,classification_type,is_system,created_by)
 values(org,'REVENUE','Revenue','REVENUE',true,owner_id) on conflict(organization_id,code) do nothing;
 select id into revenue from public.financial_classifications where organization_id=org and code='REVENUE';
 perform public.save_financial_chart_account(org,'110001','1100','ذمم العملاء','Customers','DEBIT',true,true,0,'Fixture receivable');
 perform public.save_financial_chart_account(org,'410001','4100','إيرادات الخدمة','Service revenue','CREDIT',true,true,0,'Fixture revenue');
 saved:=public.save_financial_reporting_policy(org,'2026-01-01',0,jsonb_build_array(jsonb_build_object(
  'eventType','REVENUE','sourceModule','OPERATIONAL_CONSOLE','classificationId',revenue::text||':BASE',
  'cashDirection','NON_CASH','debitAccountId','110001','creditAccountId','410001','detailed',true)), 'Detailed source template fixture');
 perform public.prepare_financial_account_rule_links(org);
 select rules,version into before_rules,v from public.financial_reporting_policies where organization_id=org and status='DRAFT';
 perform public.prepare_financial_account_rule_links(org);
 if not exists(select 1 from public.financial_reporting_policies where organization_id=org and status='DRAFT' and version=v and rules=before_rules) then raise exception 'INHERITANCE_NOT_IDEMPOTENT';end if;
 -- Adding a child through the actual chart command must prepare its usable category and rule.
 perform public.save_financial_chart_account(org,'410002','4100','إيرادات إضافية','Additional revenue','CREDIT',true,true,0,'New child after policy');
 select id into child_id from public.financial_classifications where organization_id=org and code='REVENUE_ACCOUNT_410002';
 if child_id is null then raise exception 'INHERITED_CLASSIFICATION_MISSING';end if;
 select rules into after_rules from public.financial_reporting_policies where organization_id=org and status='DRAFT';
 if not exists(select 1 from jsonb_array_elements(after_rules) r where r->>'classificationId'=child_id::text||':BASE' and r->>'creditAccountId'='410002' and r->>'debitAccountId'='110001' and r->'detailed'='true'::jsonb) then raise exception 'INHERITED_RULE_MISSING';end if;
 if not exists(select 1 from public.liquidity_flow_categories where organization_id=org and expense_classification_id=child_id and financial_classification_type='REVENUE' and allowed_direction='INFLOW' and active) then raise exception 'USABLE_CATEGORY_MISSING';end if;
 if exists(select 1 from jsonb_array_elements(before_rules) r where not after_rules @> jsonb_build_array(r)) then raise exception 'EXISTING_RULE_CHANGED';end if;
 perform private.financial_assert_detailed_rules(org,after_rules);
 if exists(select 1 from public.financial_reporting_policies where organization_id=org and status='APPROVED') then raise exception 'RULES_AUTO_APPROVED';end if;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 begin
  perform public.prepare_financial_account_rule_links(org);
  raise exception 'FOREIGN_SYNC_ALLOWED';
 exception when others then if sqlerrm<>'CHART_WRITE_DENIED' then raise;end if;end;
end $$;
select 'PASS real chart/policy RPC inheritance, usable category, exact counterpart, idempotence and tenant authorization';
rollback;
