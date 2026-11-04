-- Disposable-only full-schema accounting mapping acceptance.
begin;
do $$
declare owner uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();org uuid:=gen_random_uuid();foreign_org uuid:=gen_random_uuid();
 classification uuid:=gen_random_uuid();event_id uuid:=gen_random_uuid();unmapped_id uuid:=gen_random_uuid();
 saved jsonb;coverage jsonb;events jsonb;rules jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values(owner,owner||'@policy-coverage.invalid',now()),(outsider,outsider||'@policy-coverage.invalid',now());
 perform set_config('request.jwt.claim.sub',owner::text,true);
 insert into public.organizations(id,owner_user_id,name) values(org,owner,'Posting coverage A');
 insert into public.organization_members(organization_id,user_id,role,status) values(org,owner,'OWNER','ACTIVE');
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 insert into public.organizations(id,owner_user_id,name) values(foreign_org,outsider,'Posting coverage B');
 insert into public.organization_members(organization_id,user_id,role,status) values(foreign_org,outsider,'OWNER','ACTIVE');
 perform set_config('request.jwt.claim.sub',owner::text,true);
 insert into public.financial_classifications(id,organization_id,code,name,classification_type,created_by)
 values(classification,org,'POLICY-COVERAGE','Source coverage expense','EXPENSE',owner);
 insert into public.financial_events(id,organization_id,event_type,source_module,source_event_key,event_date,status,base_currency,created_by)
 values(event_id,org,'EXPENSE','core','coverage-a','2024-01-02','ACTUAL','SAR',owner);
 insert into public.financial_event_lines(event_id,organization_id,line_number,classification_id,amount,currency,exchange_rate,base_amount,cash_direction)
 values(event_id,org,1,classification,100,'SAR',1,100,'NON_CASH');

 events:=private.financial_reporting_events(org,'2024-01-01','2024-12-31');
 if jsonb_array_length(events)<>1 then raise exception 'Source is missing or counted twice';end if;
 coverage:=private.financial_policy_source_coverage(events,'[]'::jsonb);
 if (coverage->>'missingLines')::integer<>1 or (coverage->>'lineCount')::integer<>1 then raise exception 'Unmapped canonical source line not detected';end if;

 saved:=public.save_financial_reporting_policy(org,'2024-01-01',0,'[]'::jsonb,'Keep incomplete policy as a draft');
 begin
  perform public.approve_financial_reporting_policy((saved->>'id')::uuid,(saved->>'version')::integer);
  raise exception 'Unmapped live source was approved';
 exception when others then if sqlerrm<>'REPORTING_POLICY_SOURCE_UNMAPPED' then raise;end if;end;
 if (select status from public.financial_reporting_policies where id=(saved->>'id')::uuid)<>'DRAFT' then raise exception 'Failed approval mutated draft';end if;

 rules:=jsonb_build_array(jsonb_build_object('eventType','EXPENSE','sourceModule','core',
  'classificationId',classification::text||':BASE','cashDirection','NON_CASH','debitAccountId','6100','creditAccountId','2100'));
 coverage:=private.financial_policy_source_coverage(events,rules||rules);
 if (coverage->>'ambiguousLines')::integer<>1 then raise exception 'Ambiguous source mapping not detected';end if;
 coverage:=private.financial_policy_source_coverage(events,rules);
 if (coverage->>'mappedLines')::integer<>1 or (coverage->>'missingLines')::integer<>0 then raise exception 'Complete source mapping not recognized';end if;
 saved:=public.save_financial_reporting_policy(org,'2024-01-01',(saved->>'version')::integer,rules,'One posting rule for each source line');
 saved:=public.approve_financial_reporting_policy((saved->>'id')::uuid,(saved->>'version')::integer);
 if saved->>'status'<>'APPROVED' then raise exception 'Fully mapped source was not approved';end if;
 if (select count(*) from public.financial_events where organization_id=org)<>1 or (select count(*) from public.financial_event_lines where organization_id=org)<>1 then raise exception 'Policy created or duplicated source events';end if;

 -- New, later-posted classifications need another explicit rule before a new
 -- approval. The existing policy and audit are immutable in this test.
 insert into public.financial_events(id,organization_id,event_type,source_module,source_event_key,event_date,status,base_currency,created_by)
 values(unmapped_id,org,'EXPENSE','core','coverage-b','2024-02-01','ACTUAL','SAR',owner);
 insert into public.financial_event_lines(event_id,organization_id,line_number,classification_id,amount,currency,exchange_rate,base_amount,cash_direction)
 values(unmapped_id,org,1,classification,20,'SAR',1,20,'OUTFLOW');
 begin
  perform private.financial_assert_policy_source_coverage(org,'2024-01-01','2024-12-31',rules);
  raise exception 'New unmapped cash direction silently accepted';
 exception when others then if sqlerrm<>'REPORTING_POLICY_SOURCE_UNMAPPED' then raise;end if;end;
 if (select status from public.financial_reporting_policies where id=(saved->>'id')::uuid)<>'APPROVED' then raise exception 'Approved policy overwritten by new source';end if;

 perform set_config('request.jwt.claim.sub',outsider::text,true);
 begin perform public.financial_reporting_policy_workspace(org,'2024-01-01');raise exception 'Foreign organization policy visible';
 exception when others then if sqlerrm<>'REPORTING_ACCESS_DENIED' then raise;end if;end;
end $$;
select 'PASS complete one-to-one posting policy coverage, drafts, approval, source identity and tenant isolation';
rollback;
