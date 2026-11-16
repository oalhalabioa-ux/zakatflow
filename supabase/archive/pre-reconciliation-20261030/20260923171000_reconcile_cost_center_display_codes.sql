-- Give the existing operating-project center a distinct display code.
-- The internal code remains unchanged for backward compatibility.
update public.organization_cost_centers center
set display_code = '03',
    updated_at = now()
from public.organizations organization
where center.organization_id = organization.id
  and organization.organization_kind = 'HOLDING'
  and center.code = '01'
  and center.display_code is null
  and center.center_type in ('PROJECT_OPERATING', 'INVESTMENT')
  and not exists (
    select 1
    from public.organization_cost_centers occupied
    where occupied.organization_id = center.organization_id
      and occupied.display_code = '03'
  );

-- Existing centers that already have a stable internal code use that code as
-- their display code when no separate display code was assigned.
update public.organization_cost_centers
set display_code = code,
    updated_at = now()
where display_code is null
  and code is not null;
