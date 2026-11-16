begin;
set local lock_timeout='3s';

alter table subscription_private.bundle_modules drop constraint bundle_modules_key_check;
alter table subscription_private.bundle_modules add constraint bundle_modules_key_check
  check(key in ('assets','liquidity','zakat','vat','debts','budgets','investments','feasibility'));
insert into subscription_private.bundle_modules(key,name_ar,name_en,description_ar,description_en,icon)
values ('feasibility','دراسات الجدوى وتأسيس المشاريع','Feasibility & Project Development',
  'إعداد دراسات الجدوى والسيناريوهات والتمويل والتقارير.','Prepare feasibility studies, scenarios, funding and reports.','chart');

create or replace function subscription_private.valid_capabilities(p_caps jsonb)
returns boolean language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p_caps)='array' then
   jsonb_array_length(p_caps) between 2 and 9 and p_caps @> '["module:assets","module:liquidity"]'::jsonb
   and not exists(select 1 from jsonb_array_elements_text(p_caps) v where v not in (
     'module:assets','module:liquidity','module:zakat','module:vat','module:debts',
     'module:budgets','module:investments','module:feasibility','feature:custom_roles'))
   and (select count(*)=count(distinct v) from jsonb_array_elements_text(p_caps) v)
 else false end
$$;

-- Invoice or subscription coverage can supplement a personal trial. The lookup
-- is re-evaluated on every request and never changes an existing agreement.
create function private.feasibility_effective_access()
returns table(status text, starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path='' as $$
 with actor as (select auth.uid() as id),
 explicit_grant as (
   select g.status,g.starts_at,g.ends_at,g.source from public.feasibility_access_grants g
   join actor a on a.id=g.user_id where g.starts_at<=statement_timestamp()
 ), membership as (
   select m.organization_id from public.organization_members m
   join actor a on a.id=m.user_id join public.organizations o on o.id=m.organization_id
   where m.status='ACTIVE' and o.status='ACTIVE'
 ), paid_access as (
   select e->>'status' as state, (e->>'current_period_end')::timestamptz as period_end,
     coalesce((e->>'started_at')::timestamptz, statement_timestamp()-interval '1 second') as started
   from membership m cross join lateral subscription_private.entitlement(m.organization_id) e
   where e->'capabilities' ? 'module:feasibility'
 ), choices as (
   select g.status,g.starts_at,g.ends_at,
     case when g.source='PLATFORM_ADMIN' then 1
       when g.status in ('ACTIVE','TRIAL') and (g.ends_at is null or statement_timestamp()<g.ends_at) then 3
       else 5 end as priority
   from explicit_grant g
   union all
   select case when state='active' and period_end>statement_timestamp() then 'ACTIVE' else 'READ_ONLY' end,
     least(started,statement_timestamp()-interval '1 second'), case when state='active' and period_end>statement_timestamp() then period_end end,
     case when state='active' and period_end>statement_timestamp() then 2 else 4 end
   from paid_access
 )
 select c.status,c.starts_at,c.ends_at from choices c
 order by priority,c.ends_at desc nulls first limit 1
$$;

revoke all on function private.feasibility_effective_access() from public,anon,authenticated,service_role;
grant execute on function private.feasibility_effective_access() to authenticated;

create or replace function private.feasibility_phase1_has_access(require_write boolean)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists (
  select 1 from private.feasibility_effective_access() g
  where not require_write or (g.status in ('ACTIVE','TRIAL') and (g.ends_at is null or statement_timestamp()<g.ends_at))
 )
$$;

create function public.my_feasibility_access()
returns jsonb language sql stable security invoker set search_path='' as $$
 select to_jsonb(g) from private.feasibility_effective_access() g
$$;
revoke all on function public.my_feasibility_access() from public,anon,authenticated,service_role;
grant execute on function public.my_feasibility_access() to authenticated;

create function private.feasibility_start_trial()
returns void language plpgsql security definer set search_path='' as $$
declare
 actor uuid := auth.uid();
 days integer;
begin
 if actor is null or not exists(select 1 from auth.users u where u.id=actor and u.email_confirmed_at is not null
   and u.deleted_at is null and (u.banned_until is null or u.banned_until<=statement_timestamp())) then
   raise exception 'FEASIBILITY_VERIFIED_ACCOUNT_REQUIRED' using errcode='42501';
 end if;
 select s.trial_days into strict days from subscription_private.settings s where s.id;
 insert into public.feasibility_access_grants(user_id,status,starts_at,ends_at,source)
 values(actor,'TRIAL',statement_timestamp(),statement_timestamp()+make_interval(days=>days),'TRIAL')
 on conflict (user_id) do nothing;
end
$$;
revoke all on function private.feasibility_start_trial() from public,anon,authenticated,service_role;
grant execute on function private.feasibility_start_trial() to authenticated;

create function public.start_personal_feasibility_trial()
returns void language sql volatile security invoker set search_path='' as $$
 select private.feasibility_start_trial()
$$;
revoke all on function public.start_personal_feasibility_trial() from public,anon,authenticated,service_role;
grant execute on function public.start_personal_feasibility_trial() to authenticated;

create or replace function public.subscription_bundle_requests(p_organization_id uuid,p_action text default 'list',p_details jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare m text; r subscription_private.bundle_requests%rowtype; keys text[]; items jsonb; total numeric; currency text; e jsonb;
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED';end if;
 select role::text into m from public.organization_members where organization_id=p_organization_id and user_id=auth.uid() and status='ACTIVE';
 if m is null then raise exception 'ORGANIZATION_ACCESS_REQUIRED';end if;
 if p_action='list' then return jsonb_build_object('can_request',m in ('OWNER','ADMIN'),'rows',(select coalesce(jsonb_agg(to_jsonb(t) order by created_at desc),'[]') from (select * from subscription_private.bundle_requests where organization_id=p_organization_id and m in ('OWNER','ADMIN') order by created_at desc limit 50)t));end if;
 if m not in ('OWNER','ADMIN') then raise exception 'ORGANIZATION_ADMIN_REQUIRED';end if;
 -- Lock catalog before organization, consistently with owner activation.
 perform 1 from subscription_private.bundle_modules order by key for share;
 perform 1 from public.organizations where id=p_organization_id for update;
 if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=auth.uid() and status='ACTIVE' and role in ('OWNER','ADMIN')) then raise exception 'ORGANIZATION_ADMIN_REQUIRED';end if;
 if p_action='submit' then
  if length(coalesce(p_details->>'phone',''))>50 or length(coalesce(p_details->>'notes',''))>2000 or p_details->>'interval' not in ('monthly','yearly') then raise exception 'REQUEST_DETAILS_INVALID';end if;
  select array_agg(v->>'key' order by v->>'key') into keys from jsonb_array_elements(p_details->'modules')v;
  if keys is null or cardinality(keys) not between 2 and 8 or not ('assets'=any(keys) and 'liquidity'=any(keys)) or cardinality(keys)<>(select count(distinct k) from unnest(keys)k) then raise exception 'MODULE_DEPENDENCY_INVALID';end if;
  select * into r from subscription_private.bundle_requests where organization_id=p_organization_id and token=(p_details->>'token')::uuid;
  if found then
   if r.billing_interval is distinct from p_details->>'interval' or r.phone is distinct from coalesce(p_details->>'phone','') or r.notes is distinct from coalesce(p_details->>'notes','') or (select array_agg(v->>'key' order by v->>'key') from jsonb_array_elements(r.items)v) is distinct from keys then raise exception 'REQUEST_CONFLICT';end if;
   return to_jsonb(r);
  end if;
  if exists(select 1 from subscription_private.bundle_requests where organization_id=p_organization_id and status in ('pending','offered','accepted')) or exists(select 1 from subscription_private.activation_requests where organization_id=p_organization_id and status in ('pending','reviewing','needs_info')) then raise exception 'REQUEST_OPEN_CONFLICT';end if;
  if exists(select 1 from jsonb_array_elements(p_details->'modules')v left join subscription_private.bundle_modules b on b.key=v->>'key' where b.key is null or not b.published or b.revision is distinct from (v->>'revision')::integer) then raise exception 'MODULE_CONFLICT';end if;
  if exists(select 1 from subscription_private.bundle_modules b cross join unnest(b.requires)d where b.key=any(keys) and not d=any(keys)) then raise exception 'MODULE_DEPENDENCY_INVALID';end if;
  if (select count(distinct b.currency) from subscription_private.bundle_modules b where key=any(keys))<>1 then raise exception 'MODULE_CURRENCY_INVALID';end if;
  select jsonb_agg(to_jsonb(b) order by key),min(b.currency),case when bool_or(pricing='quote') then null else sum(case when p_details->>'interval'='monthly' then monthly else yearly end) end into items,currency,total from subscription_private.bundle_modules b where key=any(keys);
  e:=subscription_private.entitlement(p_organization_id);
  insert into subscription_private.bundle_requests(organization_id,requester_id,token,items,billing_interval,currency,total,max_users,phone,notes,status,subscription_revision)
   values(p_organization_id,auth.uid(),(p_details->>'token')::uuid,items,p_details->>'interval',currency,total,greatest(1,coalesce((e->>'max_users')::integer,1),(select count(*)::integer from public.organization_members where organization_id=p_organization_id and status='ACTIVE')),coalesce(p_details->>'phone',''),coalesce(p_details->>'notes',''),case when total is null then 'pending' else 'accepted' end,coalesce((e->>'revision')::integer,0)) returning * into r;
 else
  select * into r from subscription_private.bundle_requests where id=(p_details->>'id')::uuid and organization_id=p_organization_id for update;
  if not found or r.revision is distinct from (p_details->>'revision')::integer then raise exception 'REQUEST_CONFLICT';end if;
  if p_action='accept' and r.status='offered' then
   update subscription_private.bundle_requests set status='accepted',revision=revision+1,updated_at=now() where id=r.id returning * into r;
  elsif p_action='cancel' and r.status in ('pending','offered','accepted') then
   update subscription_private.bundle_requests set status='cancelled',revision=revision+1,updated_at=now() where id=r.id returning * into r;
  else raise exception 'REQUEST_CONFLICT';end if;
 end if;
 insert into public.platform_audit_events(actor_user_id,event_type,entity_type,entity_id,details) values(auth.uid(),'bundle.'||p_action,'bundle_request',r.id,jsonb_build_object('organization_id',p_organization_id,'revision',r.revision));
 return to_jsonb(r);
end$$;

commit;
