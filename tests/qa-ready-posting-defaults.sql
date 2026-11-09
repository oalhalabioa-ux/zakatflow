-- Real RPCs/triggers; synthetic organization only, rollback every row.
begin;
do $$
declare owner_id uuid:=gen_random_uuid();org uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();
 roles jsonb;again jsonb;rules jsonb;saved jsonb;revenue uuid;expense uuid;child uuid;n integer;before_version integer;previous uuid;
begin
 insert into auth.users(id,email,email_confirmed_at) values(owner_id,owner_id||'@ready-defaults.invalid',now()),(outsider,outsider||'@ready-defaults.invalid',now());
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 insert into public.organizations(id,owner_user_id,name,approval_policy) values(org,owner_id,'Rollback ready defaults fixture','OWNER_CONTROLLED');
 insert into public.organization_members(organization_id,user_id,role,status) values(org,owner_id,'OWNER','ACTIVE') on conflict do nothing;
 insert into public.financial_classifications(organization_id,code,name,classification_type,is_system,created_by)
 values(org,'REVENUE','Revenue','REVENUE',true,owner_id),(org,'OPEX','Expense','OPEX',true,owner_id) on conflict(organization_id,code) do nothing;
 select id into revenue from public.financial_classifications where organization_id=org and code='REVENUE';
 select id into expense from public.financial_classifications where organization_id=org and code='OPEX';
 perform public.save_financial_chart_account(org,'110001','1100','ذمم أخرى','Other receivables','DEBIT',true,true,0,'Fixture occupied code');
 perform public.save_financial_chart_account(org,'210008','2100','ذمم الموردين','Trade payables','CREDIT',true,true,0,'Fixture existing supplier control');
 roles:=public.prepare_financial_posting_defaults(org,'2026-01-01');
 if roles->>'1100'='110001' or roles->>'2100'<>'210008' or roles->>'1100'=roles->>'EMPLOYEE' or roles->>'2100'=roles->>'2200' then raise exception 'ROLE_MAPPING_INVALID';end if;
 select count(*) into n from public.financial_chart_custom_accounts where organization_id=org;
 again:=public.prepare_financial_posting_defaults(org,'2026-01-01');
 if roles<>again or n<>(select count(*) from public.financial_chart_custom_accounts where organization_id=org) then raise exception 'DEFAULTS_NOT_IDEMPOTENT';end if;
 rules:=jsonb_build_array(
 jsonb_build_object('eventType','REVENUE','sourceModule','OPERATIONAL_CONSOLE','classificationId',revenue::text||':BASE','cashDirection','NON_CASH','debitAccountId',roles->>'1100','creditAccountId',roles->>'4100','detailed',true),
 jsonb_build_object('eventType','EXPENSE','sourceModule','OPERATIONAL_CONSOLE','classificationId',expense::text||':BASE','cashDirection','NON_CASH','debitAccountId',roles->>'6100','creditAccountId',roles->>'2100','detailed',true));
 saved:=public.activate_financial_posting_defaults(org,'2026-01-01',null,0,rules);
 if saved->>'status'<>'APPROVED' or saved->>'reason' not like 'Organization defaults%' then raise exception 'BATCH_NOT_APPROVED';end if;
 perform private.financial_assert_detailed_rules(org,saved->'rules');
 previous:=(saved->>'id')::uuid;
 perform public.save_financial_chart_account(org,'410099','4100','إيراد خدمة جديد','New service revenue','CREDIT',true,true,0,'New account automatic activation');
 select id into child from public.financial_classifications where organization_id=org and code='REVENUE_ACCOUNT_410099';
 if child is null or not exists(select 1 from public.financial_reporting_policies p,jsonb_array_elements(p.rules) r where p.organization_id=org and p.status='APPROVED' and r->>'classificationId'=child::text||':BASE' and r->>'debitAccountId'=roles->>'1100' and r->>'creditAccountId'='410099') then raise exception 'NEW_CHILD_NOT_AUTO_APPROVED';end if;
 if exists(select 1 from public.financial_reporting_policies where organization_id=org and status='DRAFT') then raise exception 'UNEXPECTED_CHILD_DRAFT';end if;
 -- A second account still auto-activates after the original batch is superseded.
 perform public.save_financial_chart_account(org,'610098','6100','مصروف خدمة جديد','New service expense','DEBIT',true,true,0,'New expense automatic activation');
 if not exists(select 1 from public.financial_reporting_policies p,jsonb_array_elements(p.rules) r where p.organization_id=org and p.status='APPROVED' and r->>'debitAccountId'='610098' and r->>'creditAccountId'=roles->>'2100') then raise exception 'NEW_EXPENSE_NOT_AUTO_APPROVED';end if;
 select to_jsonb(p) into saved from public.financial_reporting_policies p where organization_id=org and status='APPROVED';
 previous:=(saved->>'id')::uuid;before_version:=(saved->>'version')::integer;
 begin
  perform public.activate_financial_posting_defaults(org,'2026-01-01',previous,before_version-1,saved->'rules');raise exception 'STALE_ACTIVATION_ALLOWED';
 exception when others then if sqlerrm<>'REPORTING_VERSION_CONFLICT' then raise;end if;end;
 -- User's pending manual edit must NOT be implicitly approved by chart creation.
 perform public.save_financial_reporting_policy(org,'2026-01-01',0,saved->'rules','User pending review');
 perform public.save_financial_chart_account(org,'410098','4100','خدمة أخرى','Another service','CREDIT',true,true,0,'Preserve pending edit');
 if not exists(select 1 from public.financial_reporting_policies where id=previous and status='APPROVED' and version=before_version) then raise exception 'MANUAL_DRAFT_AUTO_APPROVED';end if;
 if exists(select 1 from public.financial_events where organization_id=org) then raise exception 'SETUP_CREATED_VOUCHERS';end if;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 begin perform public.prepare_financial_posting_defaults(org,'2026-01-01');raise exception 'FOREIGN_DEFAULTS_ALLOWED';exception when others then if sqlerrm<>'REPORTING_SAVE_DENIED' then raise;end if;end;
end $$;
set constraints all immediate;
select 'PASS real defaults: reuse, collision, idempotency, batch approval, new revenue/expense auto-approval, manual draft preservation, stale version, zero vouchers and foreign denial';
rollback;
