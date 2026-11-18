begin;
set local lock_timeout='3s';

-- Resolve the new module for current and future subscriptions without rewriting
-- subscription snapshots, prices, trial dates, organization records or studies.
create or replace function subscription_private.entitlement(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 e jsonb;
 caps jsonb;
 s public.platform_subscriptions%rowtype;
begin
 e:=subscription_private.entitlement_state(p_org);
 select * into s from public.platform_subscriptions
 where organization_id=p_org order by created_at desc,id desc limit 1;
 if e->>'status'='legacy' or s.trial_started_at is not null and s.converted_at is null then
  caps:='["core"]'::jsonb;
 else
  caps:=coalesce(s.entitlements,'["core"]'::jsonb);
 end if;
 -- Trial access uses the original trial clock. An expired/suspended trial
 -- retains module visibility, while can_write continues to deny mutations.
 if (s.trial_started_at is not null and s.converted_at is null)
    or exists(select 1 from public.platform_plans p where p.id=s.plan_id
      and p.is_active and p.features ? 'module:feasibility') then
  if not caps ? 'module:feasibility' then
   caps:=caps||'["module:feasibility"]'::jsonb;
  end if;
 end if;
 return e||jsonb_build_object('capabilities',caps,'plan_snapshot',s.plan_snapshot);
end
$$;

create or replace function private.feasibility_has_company_plan(p_organization uuid,p_writable boolean)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((
  select e->'capabilities' ? 'module:feasibility'
   and (not p_writable or
    (e->>'status' in ('active','trialing') and (e->>'can_write')::boolean))
  from public.organizations o cross join lateral subscription_private.entitlement(o.id) e
  where o.id=p_organization and o.status='ACTIVE'
 ),false)
$$;

create or replace function private.feasibility_effective_access()
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
   select e->>'status' as state,
     case when e->>'status'='trialing' then (e->>'trial_ends_at')::timestamptz
       else (e->>'current_period_end')::timestamptz end as period_end,
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
   select case when state in ('active','trialing') and period_end>statement_timestamp() then case when state='trialing' then 'TRIAL' else 'ACTIVE' end else 'READ_ONLY' end,
     least(started,statement_timestamp()-interval '1 second'), case when state in ('active','trialing') and period_end>statement_timestamp() then period_end end,
     case when state in ('active','trialing') and period_end>statement_timestamp() then 2 else 4 end
   from paid_access
 )
 select c.status,c.starts_at,c.ends_at from choices c
 order by priority,c.ends_at desc nulls first limit 1
$$;

revoke all on function private.feasibility_effective_access() from public,anon,authenticated,service_role;
grant execute on function private.feasibility_effective_access() to authenticated;

commit;
