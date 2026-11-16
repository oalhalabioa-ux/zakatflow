-- Establish a safe holding-company hierarchy for budget organizations.
alter table public.organizations
  add column if not exists parent_organization_id uuid,
  add column if not exists organization_kind text not null default 'SUBSIDIARY',
  add column if not exists sort_order integer not null default 100;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organizations_parent_organization_id_fkey'
  ) then
    alter table public.organizations
      add constraint organizations_parent_organization_id_fkey
      foreign key (parent_organization_id)
      references public.organizations(id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'organizations_organization_kind_check'
  ) then
    alter table public.organizations
      add constraint organizations_organization_kind_check
      check (organization_kind in ('HOLDING', 'SUBSIDIARY'));
  end if;
end $$;

create index if not exists idx_organizations_parent_sort
  on public.organizations(parent_organization_id, sort_order, name);

with holding as (
  select id
  from public.organizations
  where lower(trim(name)) in (
    lower('شركة ليفانت القابضة - الادارة'),
    lower('شركة ليفانت القابضة - الإدارة'),
    lower('شركة ليفانت القابضة')
  )
  order by created_at
  limit 1
)
update public.organizations o
set organization_kind = 'HOLDING',
    parent_organization_id = null,
    sort_order = 10,
    updated_at = now()
from holding h
where o.id = h.id;

with holding as (
  select id
  from public.organizations
  where organization_kind = 'HOLDING'
  order by sort_order, created_at
  limit 1
)
update public.organizations o
set organization_kind = 'SUBSIDIARY',
    parent_organization_id = h.id,
    sort_order = 20,
    updated_at = now()
from holding h
where o.id <> h.id
  and lower(trim(o.name)) in (
    lower('شركة دعم الاعمال'),
    lower('شركة دعم الأعمال')
  );