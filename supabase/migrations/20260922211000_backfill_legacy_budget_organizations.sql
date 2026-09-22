-- Create organization references for legacy budget plans that previously
-- stored the organization only as free text. Existing budget data is kept.
with legacy as (
  select
    user_id,
    max(nullif(trim(organization_name), '')) as organization_name
  from public.budget_plans
  where nullif(trim(organization_name), '') is not null
  group by user_id
), inserted as (
  insert into public.organizations (owner_user_id, name, entity_type, base_currency)
  select l.user_id, l.organization_name, 'FAMILY', 'SAR'
  from legacy l
  where not exists (
    select 1
    from public.organizations o
    where o.owner_user_id = l.user_id
      and lower(trim(o.name)) = lower(trim(l.organization_name))
  )
  returning id, owner_user_id
)
insert into public.organization_members (organization_id, user_id, role, status)
select id, owner_user_id, 'OWNER', 'ACTIVE'
from inserted
on conflict (organization_id, user_id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status)
select o.id, o.owner_user_id, 'OWNER', 'ACTIVE'
from public.organizations o
join (
  select
    user_id,
    max(nullif(trim(organization_name), '')) as organization_name
  from public.budget_plans
  where nullif(trim(organization_name), '') is not null
  group by user_id
) l
  on l.user_id = o.owner_user_id
 and lower(trim(o.name)) = lower(trim(l.organization_name))
on conflict (organization_id, user_id) do nothing;
