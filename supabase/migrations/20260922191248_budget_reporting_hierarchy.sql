create table if not exists public.budget_dimensions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 dimension_type text not null check (dimension_type in ('ORGANIZATION','BRANCH','COST_CENTER','PROJECT')),
 code text not null,
 name text not null,
 parent_id uuid references public.budget_dimensions(id) on delete restrict,
 active boolean not null default true,
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,dimension_type,code,parent_id),
 check(parent_id is null or parent_id<>id)
);

alter table public.budget_plans add column if not exists organization_ref_id uuid references public.budget_dimensions(id) on delete restrict;
alter table public.budget_plans add column if not exists branch_ref_id uuid references public.budget_dimensions(id) on delete restrict;
alter table public.budget_plans add column if not exists cost_center_ref_id uuid references public.budget_dimensions(id) on delete restrict;
alter table public.budget_plans add column if not exists project_ref_id uuid references public.budget_dimensions(id) on delete restrict;

alter table public.budget_dimensions enable row level security;
drop policy if exists budget_dimensions_self on public.budget_dimensions;
create policy budget_dimensions_self on public.budget_dimensions for all to authenticated
 using ((select auth.uid())=user_id)
 with check ((select auth.uid())=user_id);

create index if not exists idx_budget_dimensions_user_type on public.budget_dimensions(user_id,dimension_type,active);
create index if not exists idx_budget_dimensions_parent on public.budget_dimensions(user_id,parent_id,active);
create index if not exists idx_budget_plans_scope_refs on public.budget_plans(user_id,organization_ref_id,branch_ref_id,cost_center_ref_id,project_ref_id);
grant select,insert,update on public.budget_dimensions to authenticated;

insert into public.budget_dimensions(user_id,dimension_type,code,name)
select distinct p.user_id,'ORGANIZATION','LEGACY-'||substr(md5(p.organization_name),1,12),p.organization_name
from public.budget_plans p
where nullif(trim(p.organization_name),'') is not null
on conflict (user_id,dimension_type,code,parent_id) do nothing;

update public.budget_plans p
set organization_ref_id=d.id
from public.budget_dimensions d
where p.organization_ref_id is null
 and d.user_id=p.user_id
 and d.dimension_type='ORGANIZATION'
 and d.name=p.organization_name;

insert into public.budget_dimensions(user_id,dimension_type,code,name,parent_id)
select distinct p.user_id,'COST_CENTER',p.cost_center,
 case when p.cost_center='HQ' then 'الإدارة العامة' else 'التشغيل' end,
 d.id
from public.budget_plans p
join public.budget_dimensions d on d.user_id=p.user_id and d.dimension_type='ORGANIZATION' and d.id=p.organization_ref_id
where p.cost_center in ('HQ','OPERATIONS')
on conflict (user_id,dimension_type,code,parent_id) do nothing;

update public.budget_plans p
set cost_center_ref_id=d.id
from public.budget_dimensions d
where p.cost_center_ref_id is null
 and d.user_id=p.user_id
 and d.dimension_type='COST_CENTER'
 and d.code=p.cost_center
 and d.parent_id=p.organization_ref_id;