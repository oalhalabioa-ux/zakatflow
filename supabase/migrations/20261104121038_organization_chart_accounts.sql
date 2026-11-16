-- Phase 1: organization-owned account catalog. Existing approved posting,
-- opening and statement functions keep their canonical four-digit control
-- accounts until a separately tested posting-engine integration is approved.
create table public.financial_chart_custom_accounts (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 code text not null check(code ~ '^[0-9]{6}([0-9]{2}){0,2}$'),
 parent_code text not null check(parent_code ~ '^[0-9]{4}([0-9]{2}){0,2}$'),
 reporting_code text not null check(reporting_code ~ '^[0-9]{4}$'),
 name_ar text not null check(length(trim(name_ar)) between 2 and 160),
 name_en text not null check(length(trim(name_en)) between 2 and 160),
 normal_side text not null check(normal_side in ('DEBIT','CREDIT')),
 is_postable boolean not null default true,
 is_active boolean not null default true,
 version integer not null default 1 check(version>0),
 created_by uuid not null references auth.users(id),
 updated_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(organization_id,code),
 check(length(code)=length(parent_code)+2 and left(code,length(parent_code))=parent_code)
);
create index financial_chart_parent on public.financial_chart_custom_accounts(organization_id,parent_code);
create table public.financial_chart_account_audit (
 id bigint generated always as identity primary key,
 organization_id uuid not null references public.organizations(id),
 account_id uuid not null references public.financial_chart_custom_accounts(id),
 action text not null check(action in ('CREATE','UPDATE')),
 actor_id uuid not null references auth.users(id),
 old_value jsonb,
 new_value jsonb not null,
 reason text not null,
 created_at timestamptz not null default now()
);
create index financial_chart_audit_org on public.financial_chart_account_audit(organization_id,created_at);
alter table public.financial_chart_custom_accounts enable row level security;
alter table public.financial_chart_account_audit enable row level security;
create policy chart_accounts_read on public.financial_chart_custom_accounts for select to authenticated
 using(private.financial_opening_can(organization_id,'financial_core.view'));
create policy chart_account_audit_read on public.financial_chart_account_audit for select to authenticated
 using(private.financial_opening_can(organization_id,'financial_core.view'));
revoke all on public.financial_chart_custom_accounts,public.financial_chart_account_audit from public,anon,authenticated;
grant select on public.financial_chart_custom_accounts,public.financial_chart_account_audit to authenticated;

create function public.financial_chart_workspace(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb;custom jsonb;
begin
 if not private.financial_opening_can(p_org,'financial_core.view') then raise exception 'CHART_ACCESS_DENIED';end if;
 select coalesce(jsonb_agg(a||jsonb_build_object(
  'organizationId',p_org,'parentCode',null,'reportingCode',a->>'code',
  'normalSide',case when a->>'code'='1590' or a->>'kind' in ('LIABILITY','EQUITY','REVENUE') then 'CREDIT' else 'DEBIT' end,
  'isSystem',true,'isActive',true,'isPostable',true,'version',0) order by a->>'code'),'[]'::jsonb)
 into base from jsonb_array_elements(public.financial_reporting_chart()) a;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',c.id,'code',c.code,'parentCode',c.parent_code,'reportingCode',c.reporting_code,
  'ar',c.name_ar,'en',c.name_en,'kind',r->>'kind','presentation',r->>'presentation',
  'normalSide',c.normal_side,'isSystem',false,'isActive',c.is_active,
  'isPostable',c.is_postable,'version',c.version) order by c.code),'[]'::jsonb)
 into custom from public.financial_chart_custom_accounts c
 cross join lateral (select a from jsonb_array_elements(public.financial_reporting_chart()) a where a->>'code'=c.reporting_code) root(r)
 where c.organization_id=p_org;
 return jsonb_build_object('organizationId',p_org,'accounts',base||custom,
  'canManage',private.financial_opening_can(p_org,'financial_core.create'),
  'postingIntegration','NOT_YET_ACTIVE');
end $$;
revoke all on function public.financial_chart_workspace(uuid) from public,anon;
grant execute on function public.financial_chart_workspace(uuid) to authenticated;

create function public.save_financial_chart_account(
 p_org uuid,p_code text,p_parent text,p_name_ar text,p_name_en text,
 p_normal_side text,p_is_postable boolean,p_is_active boolean,p_expected_version integer,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_account public.financial_chart_custom_accounts%rowtype;result public.financial_chart_custom_accounts%rowtype;
 root_code text;parent_postable boolean;previous jsonb;
begin
 if not private.financial_opening_can(p_org,'financial_core.create') then raise exception 'CHART_WRITE_DENIED';end if;
 if p_code is null or p_code !~ '^[0-9]{6}([0-9]{2}){0,2}$'
  or p_parent is null or p_parent !~ '^[0-9]{4}([0-9]{2}){0,2}$'
  or length(p_code)<>length(p_parent)+2 or left(p_code,length(p_parent))<>p_parent
  or length(trim(coalesce(p_name_ar,''))) not between 2 and 160
  or length(trim(coalesce(p_name_en,''))) not between 2 and 160
  or p_normal_side is null or p_normal_side not in ('DEBIT','CREDIT')
  or p_is_postable is null or p_is_active is null
  or p_expected_version is null or p_expected_version<0
  or length(trim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'CHART_INPUT_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('chart-accounts:'||p_org::text,0));
 if length(p_parent)=4 then
  if not exists(select 1 from jsonb_array_elements(public.financial_reporting_chart()) b where b->>'code'=p_parent) then raise exception 'CHART_PARENT_NOT_FOUND';end if;
  root_code:=p_parent;
 else
  select reporting_code,is_postable into root_code,parent_postable from public.financial_chart_custom_accounts
   where organization_id=p_org and code=p_parent and is_active;
  if root_code is null then raise exception 'CHART_PARENT_NOT_FOUND';end if;
  if parent_postable then raise exception 'CHART_PARENT_IS_POSTABLE';end if;
 end if;
 select * into current_account from public.financial_chart_custom_accounts where organization_id=p_org and code=p_code for update;
 if coalesce(current_account.version,0)<>p_expected_version then raise exception 'CHART_VERSION_CONFLICT';end if;
 if current_account.id is not null and (current_account.parent_code<>p_parent or current_account.reporting_code<>root_code) then raise exception 'CHART_STRUCTURE_IMMUTABLE';end if;
 if (not p_is_active or p_is_postable) and exists(
  select 1 from public.financial_chart_custom_accounts c where c.organization_id=p_org and c.parent_code=p_code and c.is_active
 ) then raise exception 'CHART_HAS_ACTIVE_CHILDREN';end if;
 previous:=case when current_account.id is null then null else to_jsonb(current_account) end;
 if current_account.id is null then
  insert into public.financial_chart_custom_accounts(organization_id,code,parent_code,reporting_code,name_ar,name_en,normal_side,is_postable,is_active,created_by,updated_by)
  values(p_org,p_code,p_parent,root_code,trim(p_name_ar),trim(p_name_en),p_normal_side,p_is_postable,p_is_active,auth.uid(),auth.uid()) returning * into result;
 else
  update public.financial_chart_custom_accounts set name_ar=trim(p_name_ar),name_en=trim(p_name_en),normal_side=p_normal_side,
   is_postable=p_is_postable,is_active=p_is_active,version=version+1,updated_by=auth.uid(),updated_at=now()
  where id=current_account.id returning * into result;
 end if;
 insert into public.financial_chart_account_audit(organization_id,account_id,action,actor_id,old_value,new_value,reason)
 values(p_org,result.id,case when previous is null then 'CREATE' else 'UPDATE' end,auth.uid(),previous,to_jsonb(result),trim(p_reason));
 return to_jsonb(result);
end $$;
revoke all on function public.save_financial_chart_account(uuid,text,text,text,text,text,boolean,boolean,integer,text) from public,anon;
grant execute on function public.save_financial_chart_account(uuid,text,text,text,text,text,boolean,boolean,integer,text) to authenticated;
