-- Align role writes with the permission catalog already enforced by the table.
-- Does not change any role, assignment, override or financial data.
create or replace function public.normalize_role_permission_catalog(p_permissions text[])
returns text[] language plpgsql immutable security invoker set search_path=pg_catalog,public as $$
declare permissions text[]:=coalesce(p_permissions,array[]::text[]); previous_count int; pair record;
begin
 if exists(select 1 from unnest(permissions) as p where p is null or p not in (
  'organization.view','organization.edit','financial_core.view','financial_core.create','financial_core.submit','financial_core.approve','financial_core.post','financial_core.reverse','financial_core.self_approve',
  'liquidity.view','liquidity.edit','liquidity.settle','vat.view','vat.edit','vat.issue','assets.view','assets.edit','budget.view','budget.edit','budget.submit','budget.approve','zakat.view','zakat.edit','audit.view'
 )) then raise exception 'ROLE_PERMISSION_INVALID'; end if;
 loop
  previous_count:=cardinality(permissions);
  for pair in select * from (values
   ('financial_core.create','financial_core.view'),('financial_core.submit','financial_core.create'),
   ('financial_core.approve','financial_core.view'),('financial_core.post','financial_core.approve'),
   ('financial_core.reverse','financial_core.post'),('financial_core.self_approve','financial_core.approve'),
   ('liquidity.edit','liquidity.view'),('liquidity.settle','liquidity.view'),('assets.edit','assets.view'),
   ('budget.edit','budget.view'),('budget.submit','budget.edit'),('budget.approve','budget.view'),
   ('vat.edit','vat.view'),('vat.issue','vat.edit'),('zakat.edit','zakat.view'),('organization.edit','organization.view')
  ) as dependencies(permission,prerequisite) loop
   if pair.permission=any(permissions) and not pair.prerequisite=any(permissions) then permissions:=array_append(permissions,pair.prerequisite); end if;
  end loop;
  exit when previous_count=cardinality(permissions);
 end loop;
 return array(select distinct p from unnest(permissions) as p order by p);
end $$;
revoke all on function public.normalize_role_permission_catalog(text[]) from public,anon,authenticated;

create or replace function public.save_organization_role(p_organization_id uuid,p_role_id uuid,p_name text,p_description text,p_permissions text[])
returns table(id uuid,name text,description text,permissions text[],created_at timestamptz)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.organization_roles%rowtype; v_permissions text[];
begin
 if auth.uid() is null or not public.is_organization_admin(p_organization_id) then raise exception 'ORGANIZATION_ADMIN_REQUIRED';end if;
 if length(trim(coalesce(p_name,''))) not between 2 and 60 then raise exception 'ROLE_NAME_INVALID';end if;
 if length(coalesce(p_description,''))>240 then raise exception 'ROLE_DETAILS_INVALID';end if;
 v_permissions:=public.normalize_role_permission_catalog(p_permissions);
 if p_role_id is null then
  insert into public.organization_roles(organization_id,name,description,permissions,created_by)
  values(p_organization_id,trim(p_name),trim(coalesce(p_description,'')),v_permissions,auth.uid()) returning * into v_row;
 else
  select * into v_row from public.organization_roles r where r.id=p_role_id and r.organization_id=p_organization_id for update;
  if not found then raise exception 'ROLE_NOT_FOUND';end if;
  if v_row.is_system_template or not v_row.is_editable then raise exception 'ROLE_LOCKED';end if;
  update public.organization_roles r set name=trim(p_name),description=trim(coalesce(p_description,'')),permissions=v_permissions,updated_at=now()
   where r.id=p_role_id and r.organization_id=p_organization_id returning r.* into v_row;
 end if;
 return query select v_row.id,v_row.name,v_row.description,v_row.permissions,v_row.created_at;
end $$;
revoke all on function public.save_organization_role(uuid,uuid,text,text,text[]) from public,anon;
grant execute on function public.save_organization_role(uuid,uuid,text,text,text[]) to authenticated;

create or replace function public.owner_update_organization_role(p_org uuid,p_role_id uuid,p_permissions text[],p_amount_limits jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or not exists(select 1 from public.organization_members m where m.organization_id=p_org and m.user_id=auth.uid() and m.status='ACTIVE' and m.role='OWNER') then raise exception 'OWNER_REQUIRED_TO_MANAGE_PERMISSIONS';end if;
 update public.organization_roles set permissions=public.normalize_role_permission_catalog(p_permissions),amount_limits=coalesce(p_amount_limits,'{}'::jsonb),updated_at=now()
 where id=p_role_id and organization_id=p_org and is_editable=true;
 if not found then raise exception 'EDITABLE_ROLE_NOT_FOUND';end if;
end $$;
revoke all on function public.owner_update_organization_role(uuid,uuid,text[],jsonb) from public,anon;
grant execute on function public.owner_update_organization_role(uuid,uuid,text[],jsonb) to authenticated;

create or replace function public.delete_organization_role(p_organization_id uuid,p_role_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare role_row public.organization_roles%rowtype;
begin
 if auth.uid() is null or not public.is_organization_admin(p_organization_id) then raise exception 'ORGANIZATION_ADMIN_REQUIRED';end if;
 select * into role_row from public.organization_roles r where r.id=p_role_id and r.organization_id=p_organization_id for update;
 if not found then raise exception 'ROLE_NOT_FOUND';end if;
 if role_row.is_system_template or not role_row.is_editable then raise exception 'ROLE_LOCKED';end if;
 delete from public.organization_roles r where r.id=p_role_id and r.organization_id=p_organization_id;
 exception when foreign_key_violation then raise exception 'ROLE_IN_USE';
end $$;
revoke all on function public.delete_organization_role(uuid,uuid) from public,anon;
grant execute on function public.delete_organization_role(uuid,uuid) to authenticated;
