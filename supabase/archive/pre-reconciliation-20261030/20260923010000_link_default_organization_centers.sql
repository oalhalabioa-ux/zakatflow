-- Link the legacy HQ and operations scopes to the default organization.
-- Keep HQ/OPERATIONS as stable internal keys for existing budget plans while
-- exposing numeric display codes to users.
alter table public.organization_cost_centers
  add column if not exists display_code text;

create unique index if not exists idx_org_cost_centers_org_display_code
  on public.organization_cost_centers(organization_id, display_code)
  where display_code is not null;

insert into public.organization_cost_centers
  (organization_id, code, display_code, name, active)
select o.id, defaults.code, defaults.display_code, defaults.name, true
from public.organizations o
cross join (values
  ('HQ', '01', 'الإدارة العامة'),
  ('OPERATIONS', '02', 'التشغيل')
) as defaults(code, display_code, name)
where lower(trim(o.name)) = lower(trim('شركة ليفانت القابضة'))
on conflict (organization_id, code) do update
  set display_code = excluded.display_code,
      name = excluded.name,
      active = true,
      updated_at = now();

grant select, insert, update on public.organization_cost_centers to authenticated;
