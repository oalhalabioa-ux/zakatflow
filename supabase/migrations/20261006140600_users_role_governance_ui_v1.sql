-- Production-safe Users role governance V1. Additive and data-preserving.
alter table public.organizations add column if not exists approval_policy text not null default 'OWNER_CONTROLLED';
alter table public.organizations drop constraint if exists organizations_approval_policy_check;
alter table public.organizations add constraint organizations_approval_policy_check check (approval_policy in ('OWNER_CONTROLLED','ROLE_BASED','STRICT_SEGREGATION'));

alter table public.organization_roles add column if not exists role_key text;
alter table public.organization_roles add column if not exists is_system_template boolean not null default false;
alter table public.organization_roles add column if not exists is_editable boolean not null default true;
alter table public.organization_roles add column if not exists amount_limits jsonb not null default '{}'::jsonb;
create unique index if not exists organization_roles_org_role_key_uq on public.organization_roles(organization_id,role_key) where role_key is not null;
alter table public.organization_roles drop constraint if exists organization_roles_permissions_check;
alter table public.organization_roles add constraint organization_roles_permissions_check check (permissions <@ array[
'organization.view','organization.edit','financial_core.view','financial_core.create','financial_core.submit','financial_core.approve','financial_core.post','financial_core.reverse','financial_core.self_approve',
'liquidity.view','liquidity.edit','liquidity.settle','vat.view','vat.edit','vat.issue','assets.view','assets.edit','budget.view','budget.edit','budget.submit','budget.approve','zakat.view','zakat.edit','audit.view'
]::text[]);

create table if not exists public.organization_member_permission_overrides (
 organization_id uuid not null references public.organizations(id) on delete cascade,user_id uuid not null,permission text not null,
 effect text not null check(effect in('ALLOW','DENY')),amount_limit numeric(24,4),currency text,created_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 primary key(organization_id,user_id,permission)
);
alter table public.organization_member_permission_overrides enable row level security;
grant select on public.organization_roles,public.organization_member_permission_overrides to authenticated;
drop policy if exists organization_roles_member_read on public.organization_roles;
create policy organization_roles_member_read on public.organization_roles for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=organization_roles.organization_id and m.user_id=auth.uid() and m.status='ACTIVE'));
drop policy if exists permission_overrides_member_read on public.organization_member_permission_overrides;
create policy permission_overrides_member_read on public.organization_member_permission_overrides for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=organization_member_permission_overrides.organization_id and m.user_id=auth.uid() and m.status='ACTIVE'));

create or replace function public.seed_default_organization_roles(p_org uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare u uuid:=auth.uid(); begin
 if u is null or not exists(select 1 from public.organization_members m where m.organization_id=p_org and m.user_id=u and m.status='ACTIVE' and m.role='OWNER') then raise exception 'OWNER_REQUIRED_TO_SEED_ROLES'; end if;
 insert into public.organization_roles(organization_id,name,description,permissions,created_by,role_key,is_system_template,is_editable,amount_limits) values
 (p_org,'CFO / Finance Manager','Finance leadership and approval',array['organization.view','financial_core.view','financial_core.create','financial_core.submit','financial_core.approve','financial_core.post','financial_core.reverse','liquidity.view','liquidity.edit','liquidity.settle','vat.view','vat.edit','vat.issue','assets.view','assets.edit','budget.view','budget.edit','budget.submit','budget.approve','zakat.view','zakat.edit'],u,'CFO',true,true,'{}'),
 (p_org,'Accountant','Day-to-day accounting preparation and submission',array['organization.view','financial_core.view','financial_core.create','financial_core.submit','liquidity.view','liquidity.edit','vat.view','vat.edit','vat.issue','assets.view','assets.edit','budget.view','budget.edit','zakat.view','zakat.edit'],u,'ACCOUNTANT',true,true,'{}'),
 (p_org,'Junior Accountant / Data Entry','Preparation and data entry without approval or settlement',array['organization.view','financial_core.view','financial_core.create','liquidity.view','vat.view','vat.edit','assets.view','assets.edit','budget.view','budget.edit','zakat.view'],u,'DATA_ENTRY',true,true,'{}'),
 (p_org,'Treasury','Cash and settlement operations',array['organization.view','financial_core.view','liquidity.view','liquidity.edit','liquidity.settle'],u,'TREASURY',true,true,'{}'),
 (p_org,'FP&A / Budget','Planning, budgeting and analysis',array['organization.view','financial_core.view','liquidity.view','budget.view','budget.edit','budget.submit'],u,'FPA',true,true,'{}'),
 (p_org,'Tax & Zakat','VAT, tax and zakat operations',array['organization.view','financial_core.view','vat.view','vat.edit','vat.issue','zakat.view','zakat.edit'],u,'TAX_ZAKAT',true,true,'{}'),
 (p_org,'Internal Auditor','Read-only audit and control review',array['organization.view','financial_core.view','liquidity.view','vat.view','assets.view','budget.view','zakat.view','audit.view'],u,'INTERNAL_AUDITOR',true,true,'{}'),
 (p_org,'Viewer','Read-only business visibility',array['organization.view','financial_core.view','liquidity.view','vat.view','assets.view','budget.view','zakat.view'],u,'VIEWER',true,true,'{}')
 on conflict(organization_id,role_key) where role_key is not null do update set name=excluded.name,description=excluded.description,is_system_template=true,is_editable=true,updated_at=now();
end $$;
create or replace function public.owner_update_organization_role(p_org uuid,p_role_id uuid,p_permissions text[],p_amount_limits jsonb default '{}'::jsonb) returns void language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 if auth.uid() is null or not exists(select 1 from public.organization_members m where m.organization_id=p_org and m.user_id=auth.uid() and m.status='ACTIVE' and m.role='OWNER') then raise exception 'OWNER_REQUIRED_TO_MANAGE_PERMISSIONS'; end if;
 update public.organization_roles set permissions=coalesce(p_permissions,array[]::text[]),amount_limits=coalesce(p_amount_limits,'{}'::jsonb),updated_at=now() where id=p_role_id and organization_id=p_org and is_editable=true;
 if not found then raise exception 'EDITABLE_ROLE_NOT_FOUND'; end if; end $$;
create or replace function public.owner_set_member_permission_override(p_org uuid,p_user uuid,p_permission text,p_effect text default null,p_amount_limit numeric default null,p_currency text default null) returns void language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 if auth.uid() is null or not exists(select 1 from public.organization_members m where m.organization_id=p_org and m.user_id=auth.uid() and m.status='ACTIVE' and m.role='OWNER') then raise exception 'OWNER_REQUIRED_TO_MANAGE_PERMISSIONS'; end if;
 if p_user=auth.uid() then raise exception 'OWNER_CANNOT_CHANGE_OWN_PERMISSION_OVERRIDE'; end if;
 if p_effect is null then delete from public.organization_member_permission_overrides where organization_id=p_org and user_id=p_user and permission=p_permission; return; end if;
 if p_effect not in('ALLOW','DENY') then raise exception 'INVALID_PERMISSION_OVERRIDE_EFFECT'; end if;
 insert into public.organization_member_permission_overrides(organization_id,user_id,permission,effect,amount_limit,currency,created_by) values(p_org,p_user,p_permission,p_effect,p_amount_limit,upper(p_currency),auth.uid())
 on conflict(organization_id,user_id,permission) do update set effect=excluded.effect,amount_limit=excluded.amount_limit,currency=excluded.currency,updated_at=now(); end $$;
create or replace function public.owner_set_organization_approval_policy(p_org uuid,p_policy text) returns void language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 if auth.uid() is null or not exists(select 1 from public.organization_members m where m.organization_id=p_org and m.user_id=auth.uid() and m.status='ACTIVE' and m.role='OWNER') then raise exception 'OWNER_REQUIRED_TO_MANAGE_PERMISSIONS'; end if;
 if p_policy not in('OWNER_CONTROLLED','ROLE_BASED','STRICT_SEGREGATION') then raise exception 'INVALID_APPROVAL_POLICY'; end if;
 update public.organizations set approval_policy=p_policy where id=p_org; end $$;
grant execute on function public.seed_default_organization_roles(uuid),public.owner_update_organization_role(uuid,uuid,text[],jsonb),public.owner_set_member_permission_override(uuid,uuid,text,text,numeric,text),public.owner_set_organization_approval_policy(uuid,text) to authenticated;