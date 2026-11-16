-- Execute against an isolated environment. Fixtures and rollout flag are rolled back.
begin;
set local statement_timeout='25s';
do $test$
declare
 owner_id uuid:=gen_random_uuid(); colleague uuid:=gen_random_uuid();
 recipient_user uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 source_org uuid:=gen_random_uuid(); free_org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid();
 project uuid:=gen_random_uuid(); selected jsonb; count_rows integer;
begin
 insert into auth.users(id,email,email_confirmed_at) values
  (owner_id,owner_id||'@share-drill.invalid',now()),(colleague,colleague||'@share-drill.invalid',now()),
  (recipient_user,recipient_user||'@share-drill.invalid',now()),(outsider,outsider||'@share-drill.invalid',now());
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 insert into public.organizations(id,owner_user_id,name) values(source_org,owner_id,'Paid source');
 perform set_config('request.jwt.claim.sub',recipient_user::text,true);
 insert into public.organizations(id,owner_user_id,name) values(free_org,recipient_user,'Unsubscribed receiver');
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 insert into public.organizations(id,owner_user_id,name) values(other_org,outsider,'Other institution');
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 insert into public.organization_members(organization_id,user_id,role,status) values
  (source_org,owner_id,'OWNER','ACTIVE'),(source_org,colleague,'ADMIN','ACTIVE'),
  (free_org,recipient_user,'OWNER','ACTIVE'),(free_org,owner_id,'ADMIN','ACTIVE'),
  (other_org,outsider,'OWNER','ACTIVE') on conflict do nothing;
 update public.platform_subscriptions set status='active',converted_at=now(),
  current_period_end=now()+interval '1 year',entitlements='["module:feasibility"]' where organization_id=source_org;
 update private.feasibility_org_feature_switch set enabled=true where singleton;

 execute 'set local role authenticated';
 if public.feasibility_company_workspace(free_org)->>'canWrite'<>'false' then raise exception 'PAID_ACCESS_SPILLED_TO_OTHER_ORG';end if;
 if public.feasibility_company_workspace(source_org)->>'canWrite'<>'true' then raise exception 'PAID_OWNER_WORKSPACE_DENIED';end if;
 insert into public.feasibility_projects(id,organization_id,title,study) values
  (project,source_org,'Saved corporate study',jsonb_build_object('id',project::text,'title','Saved corporate study','test',1));
 begin
  perform public.feasibility_company_shares('share',source_org,project,free_org,1,31);
  raise exception 'UNSUBSCRIBED_31_DAYS_ACCEPTED';
 exception when invalid_parameter_value then null;
 end;
 perform public.feasibility_company_shares('share',source_org,project,free_org,1,30);
 update public.feasibility_projects set revision=2,study=study||'{"test":2}'::jsonb where id=project;
 begin
  perform public.feasibility_company_shares('share',source_org,project,free_org,1,10);
  raise exception 'STALE_REVISION_ACCEPTED';
 exception when serialization_failure then null;
 end;

 perform set_config('request.jwt.claim.sub',colleague::text,true);
 begin
  perform public.feasibility_company_shares('share',source_org,project,free_org,2,10);
  raise exception 'EDITOR_MANAGED_OWNER_SHARE';
 exception when insufficient_privilege then null;
 end;

 perform set_config('request.jwt.claim.sub',recipient_user::text,true);
 if public.my_feasibility_access() is not null then raise exception 'SHARE_GRANTED_ACCOUNT_ENTITLEMENT';end if;
 selected:=public.feasibility_company_shares('open',free_org,project);
 if (selected->'study'->>'test') is distinct from '1' then raise exception 'SNAPSHOT_OR_RECIPIENT_READ_FAILED';end if;
 if jsonb_array_length(public.feasibility_company_shares('inbox',free_org))<>1 then raise exception 'RECIPIENT_INBOX_EMPTY';end if;
 if exists(select 1 from public.feasibility_projects where id=project) then raise exception 'RECIPIENT_HAS_GENERAL_ROW_ACCESS';end if;
 update public.feasibility_projects set revision=3 where id=project;
 get diagnostics count_rows=row_count;
 if count_rows<>0 then raise exception 'RECIPIENT_WRITE_ACCEPTED';end if;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 if public.feasibility_company_shares('open',other_org,project) is not null then raise exception 'OUTSIDER_OPEN_ACCEPTED';end if;
 begin
  perform public.feasibility_company_shares('open',free_org,project);
  raise exception 'OUTSIDER_ORGANIZATION_IMPERSONATION';
 exception when insufficient_privilege then null;
 end;

 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform public.feasibility_company_shares('revoke',source_org,project,free_org);
 perform set_config('request.jwt.claim.sub',recipient_user::text,true);
 if public.feasibility_company_shares('open',free_org,project) is not null then raise exception 'REVOKE_FAILED';end if;
 execute 'reset role';
 update private.feasibility_organization_shares
   set first_shared_at=now()-interval '31 days',expires_at=now()-interval '1 day',revoked_at=null
  where project_id=project and recipient_organization_id=free_org;
 execute 'set local role authenticated';
 if public.feasibility_company_shares('open',free_org,project) is not null then raise exception 'EXPIRED_SHARE_READABLE';end if;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 begin
  perform public.feasibility_company_shares('share',source_org,project,free_org,2,1);
  raise exception 'UNSUBSCRIBED_WINDOW_RESET';
 exception when invalid_parameter_value then null;
 end;

 execute 'reset role';
 update public.platform_subscriptions set status='active',converted_at=now(),current_period_end=now()+interval '1 year',
   entitlements='["module:feasibility"]' where organization_id=free_org;
 execute 'set local role authenticated';
 perform public.feasibility_company_shares('share',source_org,project,free_org,2,45);
 perform set_config('request.jwt.claim.sub',recipient_user::text,true);
 if public.feasibility_company_shares('open',free_org,project)->'study'->>'test' is distinct from '2' then
  raise exception 'SUBSCRIBED_RECIPIENT_NOT_ELIGIBLE';
 end if;
 execute 'reset role';
 update public.platform_subscriptions set started_at=now()-interval '1 day',current_period_end=now()-interval '1 minute'
 where organization_id=free_org;
 execute 'set local role authenticated';
 if public.feasibility_company_shares('open',free_org,project) is not null then raise exception 'LAPSED_RECEIVER_BYPASSED_MAX';end if;
 execute 'reset role';
 update public.platform_subscriptions set started_at=now()-interval '1 day',current_period_end=now()-interval '1 minute'
 where organization_id=source_org;
 execute 'set local role authenticated';
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 if public.feasibility_company_workspace(source_org)->>'canWrite'<>'false' then raise exception 'EXPIRED_SOURCE_CAN_WRITE';end if;
 begin
  perform public.feasibility_company_shares('share',source_org,project,free_org,2,1);
  raise exception 'EXPIRED_SOURCE_CAN_SHARE';
 exception when insufficient_privilege then null;
 end;
 execute 'reset role';
end
$test$;
select 'PASS company subscription scope, read-only snapshot, 30-day cap, revocation, expiry and tenant isolation' as result;
rollback;
