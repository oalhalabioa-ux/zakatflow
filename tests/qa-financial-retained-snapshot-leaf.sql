-- Rollback-only end-to-end SQL contract for the versioned retained-leaf
-- snapshot fix. Runs ONLY against disposable fully migrated Supabase.
-- The configured valid leaf must appear ONCE even if no opening, policy
-- mapping or transaction has referenced it.
begin;
do $qa_retained_leaf$
declare
 actor uuid:=gen_random_uuid();
 outsider uuid:=gen_random_uuid();
 empty_org uuid:=gen_random_uuid();
 active_org uuid:=gen_random_uuid();
 classification uuid:=gen_random_uuid();
 event_id uuid:=gen_random_uuid();
 policy jsonb;
 snapshot jsonb;
 trial jsonb;
 rules jsonb;
 org uuid;
begin
 insert into auth.users(id,email,email_confirmed_at) values
  (actor,actor||'@retained-snapshot.invalid',now()),
  (outsider,outsider||'@retained-snapshot.invalid',now());
 perform set_config('request.jwt.claim.sub',actor::text,true);
 foreach org in array array[empty_org,active_org] loop
   insert into public.organizations(id,owner_user_id,name,base_currency)
   values(org,actor,'QA retained earnings snapshot fixture','SAR');
   insert into public.organization_members(organization_id,user_id,role,status)
   values(org,actor,'OWNER','ACTIVE');
   perform public.save_financial_chart_account(org,'330001','3300',
      'أرباح مبقاة مخصصة','Custom retained earnings','CREDIT',true,true,0,
      'Create scoped retained earnings leaf');
   perform public.save_financial_fiscal_calendar(org,1,1,'330001',0,
      'Approved January fiscal settings');
 end loop;

 -- A truly new institution has no historical opening and no postings.
 policy:=public.save_financial_reporting_policy(empty_org,'2026-01-01',0,
   '[]'::jsonb,'No source events to recognize');
 perform public.approve_financial_reporting_policy((policy->>'id')::uuid,
   (policy->>'version')::integer);
 snapshot:=public.financial_statement_live_snapshot(empty_org,
   date '2026-01-01',date '2026-12-31');
 if snapshot->>'openingSourceId'<>'FIRST_ACTIVITY:2026-01-01'
 then raise exception 'RETAINED_EMPTY_ORG_IS_NOT_FIRST_ACTIVITY'; end if;
 if (select count(*) from jsonb_array_elements(snapshot->'accounts') a
      where a->>'id'='330001' and a->>'reportingCode'='3300')<>1
 then raise exception 'RETAINED_EMPTY_LEAF_OMITTED_OR_DUPLICATED'; end if;
 trial:=private.financial_fiscal_trial(snapshot,'330001');
 if (trial->>'profit')::numeric<>0
 then raise exception 'RETAINED_EMPTY_TRIAL_PROFIT_INVALID'; end if;

 -- Canonical expense: SAR 200 debit expense, credit payable. The retained
 -- leaf is deliberately not used in an opening or posting rule.
 insert into public.financial_classifications(
    id,organization_id,code,name,classification_type,created_by)
 values(classification,active_org,'QA-RETAINED-EXP',
    'Test expense classification','EXPENSE',actor);
 insert into public.financial_events(
    id,organization_id,event_type,source_module,source_event_key,
    event_date,status,base_currency,created_by)
 values(event_id,active_org,'EXPENSE','core','retained-fixture',
    date '2026-05-01','ACTUAL','SAR',actor);
 insert into public.financial_event_lines(
    event_id,organization_id,line_number,classification_id,amount,
    currency,exchange_rate,base_amount,cash_direction)
 values(event_id,active_org,1,classification,200,'SAR',1,200,'NON_CASH');
 rules:=jsonb_build_array(jsonb_build_object(
   'eventType','EXPENSE','sourceModule','core',
   'classificationId',classification::text||':BASE',
   'cashDirection','NON_CASH','debitAccountId','6100',
   'creditAccountId','2100'));
 policy:=public.save_financial_reporting_policy(active_org,
    '2026-01-01',0,rules,'One actual classified expense');
 perform public.approve_financial_reporting_policy(
    (policy->>'id')::uuid,(policy->>'version')::integer);
 snapshot:=public.financial_statement_live_snapshot(active_org,
    date '2026-01-01',date '2026-12-31');
 if jsonb_array_length(snapshot->'events')<>1
 then raise exception 'RETAINED_ACTIVE_SOURCE_COVERAGE_INCOMPLETE'; end if;
 if (select count(*) from jsonb_array_elements(snapshot->'accounts') a
     where a->>'id'='330001' and a->>'reportingCode'='3300')<>1
 then raise exception 'RETAINED_ACTIVE_LEAF_OMITTED_OR_DUPLICATED'; end if;
 trial:=private.financial_fiscal_trial(snapshot,'330001');
 if (trial->>'profit')::numeric<>-200
 then raise exception 'RETAINED_ACTIVE_TRIAL_PROFIT_INVALID'; end if;
 if (select (r->>'closing')::numeric from jsonb_array_elements(trial->'trialBalance') r
      where r->>'accountId'='330001')<>0
 then raise exception 'RETAINED_ACTIVE_LEAF_OPENING_OR_MOVEMENT_FABRICATED'; end if;

 -- No cross-tenant read via the original privileged live RPC.
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 begin
  perform public.financial_statement_live_snapshot(active_org,
    date '2026-01-01',date '2026-12-31');
  raise exception 'RETAINED_CROSS_TENANT_READ_ACCEPTED';
 exception when others then
  if sqlerrm<>'REPORTING_ACCESS_DENIED' then raise; end if;
 end;
end $qa_retained_leaf$;
select 'PASS retained earnings leaf in zero-opening, live expense and outsider denial';
rollback;
