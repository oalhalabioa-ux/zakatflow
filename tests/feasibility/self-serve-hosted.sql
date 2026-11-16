-- Run only in a disposable database after the self-serve migration.
begin;
set local statement_timeout='25s';
do $verification$
declare
 personal uuid:=gen_random_uuid(); buyer uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid();
 outsider uuid:=gen_random_uuid(); unverified uuid:=gen_random_uuid(); operator uuid:=gen_random_uuid();
 org uuid:=gen_random_uuid(); session_id uuid:=gen_random_uuid(); project uuid:=gen_random_uuid();
 answer jsonb; request_id uuid; access jsonb; selected jsonb; n integer;
begin
 insert into auth.users(id,email,email_confirmed_at) values
  (personal,personal||'@feasibility-qa.invalid',now()),(buyer,buyer||'@feasibility-qa.invalid',now()),
  (viewer,viewer||'@feasibility-qa.invalid',now()),(outsider,outsider||'@feasibility-qa.invalid',now()),
  (unverified,unverified||'@feasibility-qa.invalid',null),(operator,operator||'@feasibility-qa.invalid',now());
 insert into auth.sessions(id,user_id) values(session_id,operator);
 insert into public.platform_admins(user_id,role) values(operator,'platform_owner');
 perform set_config('request.jwt.claim.sub',buyer::text,true);
 insert into public.organizations(id,owner_user_id,name) values(org,buyer,'Feasibility subscription test');
 insert into public.organization_members(organization_id,user_id,role,status) values
  (org,buyer,'OWNER','ACTIVE'),(org,viewer,'VIEWER','ACTIVE') on conflict do nothing;

 execute 'set local role authenticated';
 perform set_config('request.jwt.claim.sub',personal::text,true);
 if public.my_feasibility_access() is not null then raise exception 'UNREQUESTED_PERSONAL_GRANT';end if;
 perform public.start_personal_feasibility_trial();
 access:=public.my_feasibility_access();
 if (access->>'status') is distinct from 'TRIAL' or (access->>'ends_at')::timestamptz<=now() then raise exception 'TRIAL_MISSING';end if;
 perform public.start_personal_feasibility_trial();
 if public.my_feasibility_access() is distinct from access then raise exception 'TRIAL_RENEWED_BY_RETRY';end if;

 perform set_config('request.jwt.claim.sub',unverified::text,true);
 begin
  perform public.start_personal_feasibility_trial();
  raise exception 'UNVERIFIED_ACCOUNT_ENROLLED';
 exception when insufficient_privilege then null;
 end;

 perform set_config('request.jwt.claim.sub',buyer::text,true);
 select jsonb_agg(jsonb_build_object('key',m->>'key','revision',(m->>'revision')::int))
 into selected from jsonb_array_elements(public.subscription_bundle_catalog()) m;
 if jsonb_array_length(selected)<>8 then raise exception 'EXPECTED_EIGHT_SELECTABLE_MODULES';end if;
 answer:=public.subscription_bundle_requests(org,'submit',jsonb_build_object(
  'token',gen_random_uuid(),'interval','monthly','modules',selected));
 if (answer->>'status') is distinct from 'pending' then raise exception 'QUOTE_FLOW_NOT_PENDING';end if;
 request_id:=(answer->>'id')::uuid;
 if public.my_feasibility_access() is not null then raise exception 'QUOTE_GRANTED_ACCESS';end if;

 perform set_config('request.jwt.claim.sub',operator::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',operator,'role','authenticated','session_id',session_id)::text,true);
 answer:=public.owner_bundle_requests('offer',jsonb_build_object(
  'id',request_id,'revision',1,'reason','Synthetic request quote','total',99,'max_users',5));

 perform set_config('request.jwt.claim.sub',buyer::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',buyer,'role','authenticated')::text,true);
 answer:=public.subscription_bundle_requests(org,'accept',jsonb_build_object('id',request_id,'revision',2));
 if (answer->>'status') is distinct from 'accepted' then raise exception 'QUOTE_ACCEPT_FAILED';end if;

 perform set_config('request.jwt.claim.sub',operator::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',operator,'role','authenticated','session_id',session_id)::text,true);
 answer:=public.owner_bundle_requests('activate',jsonb_build_object(
  'id',request_id,'revision',3,'reason','Synthetic request activation'));
 if (answer->>'status') is distinct from 'activated' then raise exception 'BUNDLE_ACTIVATION_FAILED';end if;

 perform set_config('request.jwt.claim.sub',viewer::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',viewer,'role','authenticated')::text,true);
 if (public.my_feasibility_access()->>'status') is distinct from 'ACTIVE' then raise exception 'PAID_PLAN_ACCESS_MISSING';end if;
 insert into public.feasibility_projects(id,owner_user_id,title,study)
 values(project,viewer,'Synthetic paid study',jsonb_build_object('id',project::text,'title','Synthetic paid study'));
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
 if public.my_feasibility_access() is not null or exists(select 1 from public.feasibility_projects where id=project) then
  raise exception 'OUTSIDE_MEMBERSHIP_LEAK';
 end if;
 execute 'reset role';
 update public.platform_subscriptions set started_at=now()-interval '1 day',current_period_end=now()-interval '1 minute' where organization_id=org;
 execute 'set local role authenticated';
 perform set_config('request.jwt.claim.sub',viewer::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',viewer,'role','authenticated')::text,true);
 if (public.my_feasibility_access()->>'status') is distinct from 'READ_ONLY'
 or not exists(select 1 from public.feasibility_projects where id=project) then raise exception 'EXPIRY_READBACK_FAILED';end if;
 update public.feasibility_projects set revision=2 where id=project;
 get diagnostics n=row_count;
 if n<>0 then raise exception 'EXPIRED_PLAN_WRITE_ACCEPTED';end if;
 execute 'reset role';
end $verification$;
select 'PASS trial opt-in, eight-module quote flow, paid access, expiry and tenant isolation' as result;
rollback;
