-- Add a required classification for organization cost centers.
alter table public.organization_cost_centers
  add column if not exists center_type text;

update public.organization_cost_centers c
set center_type = case
  when upper(c.code) = 'HQ' then 'ADMIN'
  when upper(c.code) = 'OPERATIONS' then 'OPERATING'
  when lower(trim(c.name)) in (
    lower('مشروع تطوير نظام مالي'),
    lower('مشروع تطوير مالي')
  ) then 'INVESTMENT'
  when lower(trim(c.name)) in (
    lower('الإدارة العامة'),
    lower('الادارة')
  ) then 'ADMIN'
  else 'OPERATING'
end
where c.center_type is null;

alter table public.organization_cost_centers
  alter column center_type set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organization_cost_centers_center_type_check'
  ) then
    alter table public.organization_cost_centers
      add constraint organization_cost_centers_center_type_check
      check (center_type in ('ADMIN','OPERATING','INVESTMENT','TREASURY','FINANCING'));
  end if;
end $$;

create index if not exists idx_org_cost_centers_org_type
  on public.organization_cost_centers(organization_id, center_type, active, name);

grant select, insert, update on public.organization_cost_centers to authenticated;