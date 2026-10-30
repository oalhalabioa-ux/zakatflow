-- Flexible roles and member permission overrides V1
create table if not exists public.organization_member_permission_overrides (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null,
 permission text not null,
 effect text not null check (effect in ('ALLOW','DENY')),
 amount_limit numeric(24,4),
 currency text,
 created_by uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key (organization_id,user_id,permission)
);
alter table public.organization_member_permission_overrides enable row level security;
alter table public.organization_roles add column if not exists role_key text;
alter table public.organization_roles add column if not exists is_system_template boolean not null default false;
alter table public.organization_roles add column if not exists is_editable boolean not null default true;
alter table public.organization_roles add column if not exists amount_limits jsonb not null default '{}'::jsonb;

create unique index if not exists organization_roles_org_role_key_uq on public.organization_roles(organization_id,role_key) where role_key is not null;

create or replace function public.effective_organization_permission(p_org uuid,p_permission text,p_amount numeric default null,p_currency text default null)
returns boolean language plpgsql stable security definer set search_path='pg_catalog','public' as $$
declare m public.organization_members%rowtype; ov record; allowed boolean:=false; lim numeric;
begin
 if auth.uid() is null then return false; end if;
 select * into m from public.organization_members where organization_id=p_org and user_id=auth.uid() and status='ACTIVE';
 if m.user_id is null then return false; end if;
 -- Owner remains the recovery authority; strict financial self-approval is governed separately by approval_policy.
 if m.role='OWNER' then return true; end if;
 select * into ov from public.organization_member_permission_overrides where organization_id=p_org and user_id=auth.uid() and permission=p_permission;
 if ov.effect='DENY' then return false; end if;
 if ov.effect='ALLOW' then
   if p_amount is not null and ov.amount_limit is not null and p_amount>ov.amount_limit then return false; end if;
   if p_currency is not null and ov.currency is not null and upper(p_currency)<>upper(ov.currency) then return false; end if;
   return true;
 end if;
 if m.custom_role_id is not null then
   select p_permission=any(r.permissions),
          nullif(r.amount_limits->>p_permission,'')::numeric
     into allowed,lim from public.organization_roles r where r.id=m.custom_role_id and r.organization_id=p_org;
   if not coalesce(allowed,false) then return false; end if;
   if p_amount is not null and lim is not null and p_amount>lim then return false; end if;
   return true;
 end if;
 return public.has_organization_permission(p_org,p_permission);
end $$;
