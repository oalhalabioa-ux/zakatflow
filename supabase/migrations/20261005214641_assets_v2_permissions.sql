-- Extend the existing organization permission vocabulary for Assets V2.
-- OWNER/ADMIN retain implicit full access. ACCOUNTANT may manage assets;
-- ADVISOR/VIEWER may read them; SHARIA_REVIEWER remains zakat-focused.
create or replace function public.has_organization_permission(p_organization_id uuid, p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_role text;
  v_custom_role_id uuid;
  v_permissions text[];
begin
  if auth.uid() is null or p_permission is null then return false; end if;

  select m.role, m.custom_role_id into v_role, v_custom_role_id
  from public.organization_members m
  where m.organization_id=p_organization_id
    and m.user_id=auth.uid()
    and m.status='ACTIVE';

  if v_role is null then return false; end if;
  if v_role in ('OWNER','ADMIN') then return true; end if;

  if v_custom_role_id is not null then
    select r.permissions into v_permissions
    from public.organization_roles r
    where r.id=v_custom_role_id and r.organization_id=p_organization_id;
    return coalesce(p_permission=any(v_permissions),false);
  end if;

  v_permissions:=case v_role
    when 'ACCOUNTANT' then array[
      'liquidity.view','liquidity.edit','vat.view','vat.edit','vat.issue',
      'organization.view','zakat.view','zakat.edit','assets.view','assets.edit'
    ]::text[]
    when 'ADVISOR' then array[
      'liquidity.view','liquidity.edit','vat.view','organization.view',
      'zakat.view','assets.view'
    ]::text[]
    when 'VIEWER' then array[
      'liquidity.view','vat.view','organization.view','zakat.view','assets.view'
    ]::text[]
    when 'SHARIA_REVIEWER' then array['organization.view','zakat.view']::text[]
    else array[]::text[]
  end;

  return p_permission=any(v_permissions);
end
$$;
