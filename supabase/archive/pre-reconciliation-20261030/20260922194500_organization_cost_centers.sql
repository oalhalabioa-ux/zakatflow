create table if not exists public.organization_cost_centers (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 code text not null,
 name text not null,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (organization_id, code)
);

alter table public.organization_cost_centers enable row level security;

drop policy if exists organization_cost_centers_read on public.organization_cost_centers;
create policy organization_cost_centers_read on public.organization_cost_centers
 for select to authenticated
 using (exists (
   select 1 from public.organization_members m
   where m.organization_id = organization_cost_centers.organization_id
     and m.user_id = (select auth.uid())
 ));

drop policy if exists organization_cost_centers_manage on public.organization_cost_centers;
create policy organization_cost_centers_manage on public.organization_cost_centers
 for all to authenticated
 using (exists (
   select 1 from public.organization_members m
   where m.organization_id = organization_cost_centers.organization_id
     and m.user_id = (select auth.uid())
     and m.role in ('OWNER','ADMIN')
 ))
 with check (exists (
   select 1 from public.organization_members m
   where m.organization_id = organization_cost_centers.organization_id
     and m.user_id = (select auth.uid())
     and m.role in ('OWNER','ADMIN')
 ));

create index if not exists idx_org_cost_centers_org_active
 on public.organization_cost_centers(organization_id, active, name);

grant select, insert, update on public.organization_cost_centers to authenticated;
