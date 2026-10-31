-- Control-plane requests: no payment, automatic activation or existing customer mutation.
create table subscription_private.activation_requests (
 id uuid primary key default gen_random_uuid(),
 request_number bigint generated always as identity unique,
 organization_id uuid not null references public.organizations(id),
 plan_id uuid not null references public.platform_plans(id),
 requester_id uuid references auth.users(id) on delete set null,
 requester_name text not null, requester_email text not null,
 phone text not null default '', notes text not null default '',
 quote jsonb not null, subscription_revision integer not null,
 status text not null default 'pending' check(status in ('pending','reviewing','needs_info','approved','rejected','cancelled')),
 revision integer not null default 1,
 reason text, reviewed_by uuid references auth.users(id) on delete set null,
 approved_until timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index activation_requests_one_open on subscription_private.activation_requests(organization_id) where status in ('pending','reviewing','needs_info');
alter table subscription_private.activation_requests enable row level security;
revoke all on subscription_private.activation_requests from public,anon,authenticated,service_role;
create table subscription_private.payment_readiness (
 id boolean primary key default true check(id), enabled boolean not null default false check(not enabled),
 provider text not null default '', environment text not null default 'test' check(environment in ('test','production')),
 revision integer not null default 1
);
alter table subscription_private.payment_readiness enable row level security;
revoke all on subscription_private.payment_readiness from public,anon,authenticated,service_role;
insert into subscription_private.payment_readiness(id) values(true);

create function public.subscription_activation_requests(p_organization_id uuid,p_action text default 'list',p_plan_id uuid default null,p_phone text default '',p_notes text default '',p_request_id uuid default null,p_revision integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m text;r subscription_private.activation_requests%rowtype; q jsonb;result jsonb;actor_name text;actor_email text;
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED' using errcode='42501';end if;
 select role::text into m from public.organization_members where organization_id=p_organization_id and user_id=auth.uid() and status='ACTIVE';
 if m is null then raise exception 'ORGANIZATION_ACCESS_REQUIRED' using errcode='42501';end if;
 if p_action='list' then
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]') into result from (select * from subscription_private.activation_requests where organization_id=p_organization_id and m in ('OWNER','ADMIN') order by created_at desc limit 50)t;
  select coalesce(p.name,''),u.email into actor_name,actor_email from auth.users u left join public.profiles p on p.id=u.id where u.id=auth.uid();
  return jsonb_build_object('rows',result,'can_request',m in ('OWNER','ADMIN'),'name',actor_name,'email',actor_email);
 end if;
 if m not in ('OWNER','ADMIN') then raise exception 'ORGANIZATION_ADMIN_REQUIRED' using errcode='42501';end if;
 if p_action='submit' then
  if length(coalesce(p_phone,''))>50 or length(coalesce(p_notes,''))>2000 then raise exception 'REQUEST_DETAILS_INVALID';end if;
  perform 1 from public.platform_plans where id=p_plan_id and is_active and is_published and code<>'trial_30d' for share;
  if not found then raise exception 'ACTIVE_PLAN_REQUIRED';end if;
 end if;
 -- Same ordering as subscription activation and seat guards, serializing simultaneous submissions.
 perform 1 from public.organizations where id=p_organization_id for update;
 -- Recheck live membership after the organization lock (member removal can race a submission).
 if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=auth.uid() and status='ACTIVE' and role in ('OWNER','ADMIN')) then raise exception 'ORGANIZATION_ADMIN_REQUIRED' using errcode='42501';end if;
 if p_action='submit' then
  select * into r from subscription_private.activation_requests where organization_id=p_organization_id and status in ('pending','reviewing','needs_info');
  if found then
   if r.plan_id=p_plan_id then return to_jsonb(r);end if;
   raise exception 'REQUEST_OPEN_CONFLICT';
  end if;
  q:=subscription_private.plan_snapshot(p_plan_id);
  select coalesce(p.name,''),u.email into actor_name,actor_email from auth.users u left join public.profiles p on p.id=u.id where u.id=auth.uid();
  insert into subscription_private.activation_requests(organization_id,plan_id,requester_id,requester_name,requester_email,phone,notes,quote,subscription_revision)
   values(p_organization_id,p_plan_id,auth.uid(),coalesce(actor_name,''),coalesce(actor_email,''),trim(coalesce(p_phone,'')),trim(coalesce(p_notes,'')),q,coalesce((subscription_private.entitlement(p_organization_id)->>'revision')::integer,0)) returning * into r;
 elsif p_action='resubmit' then
  if length(coalesce(p_phone,''))>50 or length(coalesce(p_notes,''))>2000 then raise exception 'REQUEST_DETAILS_INVALID';end if;
  select * into r from subscription_private.activation_requests where id=p_request_id and organization_id=p_organization_id for update;
  if not found or r.revision is distinct from p_revision or r.status<>'needs_info' then raise exception 'REQUEST_CONFLICT';end if;
  update subscription_private.activation_requests set phone=trim(coalesce(p_phone,'')),notes=trim(coalesce(p_notes,'')),status='pending',revision=revision+1,updated_at=now() where id=r.id returning * into r;
 elsif p_action='cancel' then
  select * into r from subscription_private.activation_requests where id=p_request_id and organization_id=p_organization_id for update;
  if not found or r.revision is distinct from p_revision or r.status not in ('pending','reviewing','needs_info') then raise exception 'REQUEST_CONFLICT';end if;
  update subscription_private.activation_requests set status='cancelled',revision=revision+1,updated_at=now() where id=r.id returning * into r;
 else raise exception 'REQUEST_ACTION_INVALID';end if;
 insert into public.platform_audit_events(actor_user_id,event_type,entity_type,entity_id,details) values(auth.uid(),'activation_request.'||p_action,'subscription_activation_request',r.id,jsonb_build_object('organization_id',p_organization_id,'request_number',r.request_number));
 return to_jsonb(r);
end$$;

create function public.owner_activation_requests(p_search text default '',p_status text default '',p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.owner_authorized() then raise exception 'PLATFORM_OWNER_REQUIRED' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from(
 select r.*,o.name organization_name,subscription_private.entitlement(o.id) entitlement from subscription_private.activation_requests r join public.organizations o on o.id=r.organization_id
 where (coalesce(p_status,'')='' or r.status=p_status) and (coalesce(p_search,'')='' or o.name ilike '%'||left(p_search,120)||'%' or r.requester_email ilike '%'||left(p_search,120)||'%' or r.request_number::text=left(p_search,120))
 order by r.created_at desc,r.id limit 50 offset greatest(0,coalesce(p_offset,0)))t;
 return jsonb_build_object('rows',result,'pending_count',(select count(*) from subscription_private.activation_requests where status in ('pending','reviewing','needs_info')),'payment',(select to_jsonb(p)-'id' from subscription_private.payment_readiness p where id));
end$$;

create function public.owner_review_activation_request(p_request_id uuid,p_revision integer,p_action text,p_reason text,p_until timestamptz default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r subscription_private.activation_requests%rowtype;org uuid;pid uuid;next_status text;e jsonb;
begin
 if not public.owner_authorized() then raise exception 'PLATFORM_OWNER_REQUIRED' using errcode='42501';end if;
 if length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'ADMIN_REASON_REQUIRED';end if;
 select organization_id,plan_id into org,pid from subscription_private.activation_requests where id=p_request_id;
 if not found then raise exception 'REQUEST_NOT_FOUND';end if;
 perform 1 from public.platform_plans where id=pid for share;
 perform 1 from public.organizations where id=org for update;
 select * into r from subscription_private.activation_requests where id=p_request_id for update;
 if r.revision is distinct from p_revision or r.status not in ('pending','reviewing','needs_info') then raise exception 'REQUEST_CONFLICT';end if;
 next_status:=case p_action when 'review' then 'reviewing' when 'needs_info' then 'needs_info' when 'reject' then 'rejected' when 'approve' then 'approved' end;
 if next_status is null then raise exception 'REQUEST_ACTION_INVALID';end if;
 if p_action='approve' then
  if not exists(select 1 from public.platform_plans where id=pid and is_active and is_published) or r.quote is distinct from subscription_private.plan_snapshot(pid) then raise exception 'PLAN_QUOTE_CONFLICT';end if;
  e:=subscription_private.entitlement(org);
  if coalesce((e->>'revision')::integer,0)<>r.subscription_revision then raise exception 'SUBSCRIPTION_CONFLICT';end if;
  perform public.owner_manage_trial('activate',p_reason,org,r.subscription_revision,null,p_until,pid,(r.quote->>'max_users')::integer);
 end if;
 update subscription_private.activation_requests set status=next_status,reason=trim(p_reason),reviewed_by=auth.uid(),approved_until=case when p_action='approve' then p_until else null end,revision=revision+1,updated_at=now() where id=r.id returning * into r;
 insert into public.platform_audit_events(actor_user_id,event_type,entity_type,entity_id,details) values(auth.uid(),'activation_request.'||p_action,'subscription_activation_request',r.id,jsonb_build_object('organization_id',org,'reason',trim(p_reason),'status',next_status,'quote',r.quote));
 return to_jsonb(r);
end$$;

create function public.owner_subscription_panel(p_organization_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.owner_authorized() then raise exception 'PLATFORM_OWNER_REQUIRED' using errcode='42501';end if;
 if p_organization_id is null then
  select jsonb_build_object('total',count(*),'active',count(*) filter(where e->>'status'='active'),'trialing',count(*) filter(where e->>'status'='trialing'),'expired',count(*) filter(where e->>'status'='expired')) into result from public.organizations o cross join lateral(select subscription_private.entitlement(o.id)e)t;
 else
  select jsonb_build_object('members',coalesce((select jsonb_agg(to_jsonb(t)) from(select m.user_id,m.role,m.status,coalesce(p.name,'') name,u.email from public.organization_members m left join public.profiles p on p.id=m.user_id left join auth.users u on u.id=m.user_id where m.organization_id=p_organization_id order by m.user_id limit 100)t),'[]'),'entitlement',subscription_private.entitlement(p_organization_id)) into result;
 end if;
 return result;
end$$;

create function public.owner_payment_readiness(p_provider text,p_environment text,p_revision integer,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r subscription_private.payment_readiness%rowtype;
begin
 if not public.owner_authorized() then raise exception 'PLATFORM_OWNER_REQUIRED' using errcode='42501';end if;
 if length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'ADMIN_REASON_REQUIRED';end if;
 if p_environment not in ('test','production') or p_provider is null or length(p_provider)>80 then raise exception 'PAYMENT_METADATA_INVALID';end if;
 select * into r from subscription_private.payment_readiness where id for update;
 if r.revision is distinct from p_revision then raise exception 'PAYMENT_CONFLICT';end if;
 update subscription_private.payment_readiness set provider=trim(p_provider),environment=p_environment,revision=revision+1 where id returning * into r;
 insert into public.platform_audit_events(actor_user_id,event_type,entity_type,entity_id,details) values(auth.uid(),'payment.readiness','payment_readiness',null,jsonb_build_object('reason',trim(p_reason),'provider',r.provider,'environment',r.environment,'enabled',false));
 return to_jsonb(r)-'id';
end$$;
revoke all on function public.subscription_activation_requests(uuid,text,uuid,text,text,uuid,integer),public.owner_activation_requests(text,text,integer),public.owner_review_activation_request(uuid,integer,text,text,timestamptz),public.owner_subscription_panel(uuid),public.owner_payment_readiness(text,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.subscription_activation_requests(uuid,text,uuid,text,text,uuid,integer),public.owner_activation_requests(text,text,integer),public.owner_review_activation_request(uuid,integer,text,text,timestamptz),public.owner_subscription_panel(uuid),public.owner_payment_readiness(text,text,integer,text) to authenticated;
