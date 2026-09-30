-- Organization-scoped custom roles with permission checks enforced by RLS.
create table public.organization_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 60),
  description text not null default '' check (length(description) <= 240),
  permissions text[] not null default '{}',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint organization_roles_permissions_check check (permissions <@ array[
    'liquidity.view','liquidity.edit',
    'vat.view','vat.edit','vat.issue',
    'organization.view','organization.edit',
    'zakat.view','zakat.edit'
  ]::text[])
);
create unique index organization_roles_name_unique
  on public.organization_roles (organization_id, lower(name));
alter table public.organization_roles enable row level security;
revoke all on public.organization_roles from anon, authenticated;

alter table public.organization_members add column custom_role_id uuid;
alter table public.organization_members drop constraint organization_members_role_check;
alter table public.organization_members add constraint organization_members_role_check
  check (role = any (array['OWNER','ADMIN','ACCOUNTANT','ADVISOR','VIEWER','SHARIA_REVIEWER','CUSTOM']::text[]));
alter table public.organization_members add constraint organization_members_custom_role_check
  check ((role = 'CUSTOM') = (custom_role_id is not null));
alter table public.organization_members add constraint organization_members_custom_role_fkey
  foreign key (organization_id, custom_role_id)
  references public.organization_roles (organization_id, id) on delete restrict;

alter table public.organization_invitations add column custom_role_id uuid;
alter table public.organization_invitations add constraint organization_invitations_custom_role_check
  check ((role = 'CUSTOM') = (custom_role_id is not null));
alter table public.organization_invitations add constraint organization_invitations_custom_role_fkey
  foreign key (organization_id, custom_role_id)
  references public.organization_roles (organization_id, id) on delete restrict;

create or replace function public.has_organization_permission(p_organization_id uuid, p_permission text)
returns boolean
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
  v_custom_role_id uuid;
  v_permissions text[];
begin
  if auth.uid() is null or p_permission is null then return false; end if;
  select m.role, m.custom_role_id into v_role, v_custom_role_id
  from public.organization_members m
  where m.organization_id = p_organization_id
    and m.user_id = auth.uid()
    and m.status = 'ACTIVE';
  if v_role is null then return false; end if;
  if v_role in ('OWNER','ADMIN') then return true; end if;
  if v_custom_role_id is not null then
    select r.permissions into v_permissions
    from public.organization_roles r
    where r.id = v_custom_role_id and r.organization_id = p_organization_id;
    return coalesce(p_permission = any(v_permissions), false);
  end if;
  v_permissions := case v_role
    when 'ACCOUNTANT' then array[
      'liquidity.view','liquidity.edit','vat.view','vat.edit','vat.issue',
      'organization.view','zakat.view','zakat.edit'
    ]::text[]
    when 'ADVISOR' then array[
      'liquidity.view','liquidity.edit','vat.view','organization.view',
      'zakat.view'
    ]::text[]
    when 'VIEWER' then array[
      'liquidity.view','vat.view','organization.view','zakat.view'
    ]::text[]
    when 'SHARIA_REVIEWER' then array['organization.view','zakat.view']::text[]
    else array[]::text[]
  end;
  return p_permission = any(v_permissions);
end;
$$;
revoke all on function public.has_organization_permission(uuid,text) from public, anon;
grant execute on function public.has_organization_permission(uuid,text) to authenticated;

create or replace function public.list_organization_roles(p_organization_id uuid)
returns table(id uuid, name text, description text, permissions text[], created_at timestamptz, member_count bigint)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.is_organization_admin(p_organization_id) then
    raise exception 'ORGANIZATION_ADMIN_REQUIRED';
  end if;
  return query
    select r.id, r.name, r.description, r.permissions, r.created_at,
      (select count(*) from public.organization_members m where m.custom_role_id = r.id and m.status = 'ACTIVE')
    from public.organization_roles r
    where r.organization_id = p_organization_id
    order by lower(r.name), r.created_at;
end;
$$;

create or replace function public.save_organization_role(
  p_organization_id uuid, p_role_id uuid, p_name text, p_description text, p_permissions text[]
)
returns table(id uuid, name text, description text, permissions text[], created_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.organization_roles%rowtype;
  v_permissions text[] := coalesce(p_permissions, array[]::text[]);
begin
  if auth.uid() is null or not public.is_organization_admin(p_organization_id) then
    raise exception 'ORGANIZATION_ADMIN_REQUIRED';
  end if;
  if length(trim(coalesce(p_name,''))) not between 2 and 60 then raise exception 'ROLE_NAME_INVALID'; end if;
  if exists (select 1 from unnest(v_permissions) x where x not in (
    'liquidity.view','liquidity.edit','vat.view','vat.edit','vat.issue',
    'organization.view','organization.edit','zakat.view','zakat.edit'
  )) then raise exception 'ROLE_PERMISSION_INVALID'; end if;
  if 'liquidity.edit' = any(v_permissions) and not 'liquidity.view' = any(v_permissions) then v_permissions := array_append(v_permissions,'liquidity.view'); end if;
  if ('vat.edit' = any(v_permissions) or 'vat.issue' = any(v_permissions)) and not 'vat.view' = any(v_permissions) then v_permissions := array_append(v_permissions,'vat.view'); end if;
  if 'vat.issue' = any(v_permissions) and not 'vat.edit' = any(v_permissions) then v_permissions := array_append(v_permissions,'vat.edit'); end if;
  if 'organization.edit' = any(v_permissions) and not 'organization.view' = any(v_permissions) then v_permissions := array_append(v_permissions,'organization.view'); end if;
  if 'zakat.edit' = any(v_permissions) and not 'zakat.view' = any(v_permissions) then v_permissions := array_append(v_permissions,'zakat.view'); end if;
  if p_role_id is null then
    insert into public.organization_roles (organization_id,name,description,permissions,created_by)
    values (p_organization_id,trim(p_name),trim(coalesce(p_description,'')),v_permissions,auth.uid())
    returning * into v_row;
  else
    update public.organization_roles r set name=trim(p_name), description=trim(coalesce(p_description,'')),
      permissions=v_permissions, updated_at=now()
    where r.id=p_role_id and r.organization_id=p_organization_id
    returning r.* into v_row;
    if not found then raise exception 'ROLE_NOT_FOUND'; end if;
  end if;
  return query select v_row.id,v_row.name,v_row.description,v_row.permissions,v_row.created_at;
end;
$$;

create or replace function public.delete_organization_role(p_organization_id uuid,p_role_id uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.is_organization_admin(p_organization_id) then
    raise exception 'ORGANIZATION_ADMIN_REQUIRED';
  end if;
  delete from public.organization_roles r where r.id=p_role_id and r.organization_id=p_organization_id;
  if not found then raise exception 'ROLE_NOT_FOUND'; end if;
exception when foreign_key_violation then
  raise exception 'ROLE_IN_USE';
end;
$$;

-- Remove the old three-argument overload; otherwise PostgREST sees an ambiguous call.
drop function public.create_organization_invitation(uuid,text,text);
create function public.create_organization_invitation(
  p_organization_id uuid, p_email text, p_role text, p_custom_role_id uuid default null
)
returns table(id uuid, token text, email text, role text, expires_at timestamptz, custom_role_id uuid, custom_role_name text)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_role text;
  v_email text := lower(trim(p_email));
  v_role text := p_role;
  v_row public.organization_invitations%rowtype;
  v_role_name text;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select m.role into v_actor_role from public.organization_members m
    where m.organization_id=p_organization_id and m.user_id=auth.uid() and m.status='ACTIVE';
  if v_actor_role not in ('OWNER','ADMIN') then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
  if p_custom_role_id is not null then
    select r.name into v_role_name from public.organization_roles r
      where r.id=p_custom_role_id and r.organization_id=p_organization_id;
    if v_role_name is null then raise exception 'ROLE_NOT_FOUND'; end if;
    v_role := 'CUSTOM';
  elsif p_role not in ('ACCOUNTANT','ADVISOR','VIEWER','SHARIA_REVIEWER') then
    raise exception 'ROLE_INVALID';
  end if;
  if v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then raise exception 'EMAIL_INVALID'; end if;
  if exists (select 1 from public.organization_members m join auth.users u on u.id=m.user_id
    where m.organization_id=p_organization_id and lower(u.email)=v_email and m.status='ACTIVE') then
    raise exception 'USER_ALREADY_MEMBER';
  end if;
  update public.organization_invitations as inv set expires_at=now()
    where inv.organization_id=p_organization_id and lower(inv.email)=v_email
      and inv.accepted_at is null and inv.expires_at>now();
  insert into public.organization_invitations (organization_id,email,role,custom_role_id)
    values (p_organization_id,v_email,v_role,p_custom_role_id) returning * into v_row;
  return query select v_row.id,v_row.token,v_row.email,v_row.role,v_row.expires_at,v_row.custom_role_id,v_role_name;
end;
$$;

drop function public.list_organization_users(uuid);
create function public.list_organization_users(p_organization_id uuid)
returns table(user_id uuid,email text,name text,role text,status text,created_at timestamptz,custom_role_id uuid,custom_role_name text)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.is_organization_admin(p_organization_id) then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
  return query select m.user_id,u.email::text,p.name,m.role,m.status,m.created_at,m.custom_role_id,r.name
    from public.organization_members m join public.profiles p on p.id=m.user_id
    join auth.users u on u.id=m.user_id left join public.organization_roles r on r.id=m.custom_role_id
    where m.organization_id=p_organization_id order by m.created_at,p.name;
end;
$$;
drop function public.list_organization_invitations(uuid);
create function public.list_organization_invitations(p_organization_id uuid)
returns table(id uuid,email text,role text,expires_at timestamptz,accepted_at timestamptz,created_at timestamptz,custom_role_id uuid,custom_role_name text)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.is_organization_admin(p_organization_id) then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
  return query select i.id,i.email,i.role,i.expires_at,i.accepted_at,i.created_at,i.custom_role_id,r.name
    from public.organization_invitations i left join public.organization_roles r on r.id=i.custom_role_id
    where i.organization_id=p_organization_id order by i.created_at desc;
end;
$$;

drop function public.manage_organization_member(uuid,uuid,text,text);
create function public.manage_organization_member(
  p_organization_id uuid,p_user_id uuid,p_role text,p_status text,p_custom_role_id uuid default null
)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_actor_role text; v_target_role text; v_next_role text := p_role;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select m.role into v_actor_role from public.organization_members m
    where m.organization_id=p_organization_id and m.user_id=auth.uid() and m.status='ACTIVE';
  if v_actor_role not in ('OWNER','ADMIN') then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
  if p_custom_role_id is not null then
    if not exists(select 1 from public.organization_roles r where r.id=p_custom_role_id and r.organization_id=p_organization_id) then raise exception 'ROLE_NOT_FOUND'; end if;
    v_next_role := 'CUSTOM';
  elsif p_role not in ('OWNER','ADMIN','ACCOUNTANT','ADVISOR','VIEWER','SHARIA_REVIEWER') then
    raise exception 'ROLE_INVALID';
  end if;
  if p_status not in ('ACTIVE','INACTIVE') then raise exception 'MEMBER_VALUE_INVALID'; end if;
  select m.role into v_target_role from public.organization_members m where m.organization_id=p_organization_id and m.user_id=p_user_id for update;
  if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
  if v_actor_role <> 'OWNER' and (v_target_role in ('OWNER','ADMIN') or v_next_role in ('OWNER','ADMIN')) then raise exception 'ROLE_FORBIDDEN'; end if;
  if v_target_role='OWNER' and (v_next_role<>'OWNER' or p_status<>'ACTIVE') and not exists(
    select 1 from public.organization_members m where m.organization_id=p_organization_id and m.user_id<>p_user_id and m.role='OWNER' and m.status='ACTIVE'
  ) then raise exception 'LAST_OWNER_REQUIRED'; end if;
  if p_user_id=auth.uid() and (v_next_role<>v_actor_role or p_status<>'ACTIVE') then raise exception 'CANNOT_CHANGE_OWN_ACCESS'; end if;
  update public.organization_members set role=v_next_role,custom_role_id=p_custom_role_id,status=p_status
    where organization_id=p_organization_id and user_id=p_user_id;
end;
$$;

create or replace function public.accept_organization_invitation(p_token text)
returns table(organization_id uuid,organization_name text,role text)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_user_id uuid:=auth.uid(); v_email text; v_invitation public.organization_invitations%rowtype;
begin
  if v_user_id is null then raise exception 'UNAUTHORIZED'; end if;
  select lower(u.email) into v_email from auth.users u where u.id=v_user_id and u.email_confirmed_at is not null;
  if v_email is null then raise exception 'EMAIL_NOT_VERIFIED'; end if;
  select i.* into v_invitation from public.organization_invitations i where i.token=p_token and i.accepted_at is null and i.expires_at>now() for update;
  if not found then raise exception 'INVITATION_INVALID_OR_EXPIRED'; end if;
  if lower(v_invitation.email)<>v_email then raise exception 'INVITATION_EMAIL_MISMATCH'; end if;
  if v_invitation.role not in ('ACCOUNTANT','ADVISOR','VIEWER','SHARIA_REVIEWER','CUSTOM') then raise exception 'INVITATION_ROLE_INVALID'; end if;
  insert into public.organization_members(organization_id,user_id,role,status,custom_role_id)
    values(v_invitation.organization_id,v_user_id,v_invitation.role,'ACTIVE',v_invitation.custom_role_id)
    on conflict(organization_id,user_id) do update set role=excluded.role,status='ACTIVE',custom_role_id=excluded.custom_role_id;
  update public.organization_invitations set accepted_at=now() where id=v_invitation.id;
  return query select o.id,o.name,v_invitation.role from public.organizations o where o.id=v_invitation.organization_id;
end;
$$;

revoke all on function public.list_organization_users(uuid) from public,anon;
revoke all on function public.list_organization_invitations(uuid) from public,anon;
revoke all on function public.create_organization_invitation(uuid,text,text,uuid) from public,anon;
revoke all on function public.manage_organization_member(uuid,uuid,text,text,uuid) from public,anon;
revoke all on function public.accept_organization_invitation(text) from public,anon;
revoke all on function public.list_organization_roles(uuid) from public,anon;
revoke all on function public.save_organization_role(uuid,uuid,text,text,text[]) from public,anon;
revoke all on function public.delete_organization_role(uuid,uuid) from public,anon;
grant execute on function public.list_organization_users(uuid) to authenticated;
grant execute on function public.list_organization_invitations(uuid) to authenticated;
grant execute on function public.create_organization_invitation(uuid,text,text,uuid) to authenticated;
grant execute on function public.manage_organization_member(uuid,uuid,text,text,uuid) to authenticated;
grant execute on function public.accept_organization_invitation(text) to authenticated;
grant execute on function public.list_organization_roles(uuid) to authenticated;
grant execute on function public.save_organization_role(uuid,uuid,text,text,text[]) to authenticated;
grant execute on function public.delete_organization_role(uuid,uuid) to authenticated;

-- Apply permissions to the organization-shared operational data.
create or replace function private.can_write_liquidity(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select public.has_organization_permission(p_organization_id,'liquidity.edit');
$$;
revoke all on function private.can_write_liquidity(uuid) from public,anon;
grant execute on function private.can_write_liquidity(uuid) to authenticated;

drop policy if exists liquidity_accounts_member_read on public.liquidity_accounts;
create policy liquidity_accounts_member_read on public.liquidity_accounts for select to authenticated using (public.has_organization_permission(organization_id,'liquidity.view'));
drop policy if exists liquidity_counterparties_member_read on public.liquidity_counterparties;
create policy liquidity_counterparties_member_read on public.liquidity_counterparties for select to authenticated using (public.has_organization_permission(organization_id,'liquidity.view'));
drop policy if exists liquidity_flow_categories_read on public.liquidity_flow_categories;
create policy liquidity_flow_categories_read on public.liquidity_flow_categories for select to authenticated using (public.has_organization_permission(organization_id,'liquidity.view'));
drop policy if exists liquidity_flows_member_read on public.liquidity_flows;
create policy liquidity_flows_member_read on public.liquidity_flows for select to authenticated using (public.has_organization_permission(organization_id,'liquidity.view'));
drop policy if exists liquidity_transfers_member_read on public.liquidity_transfers;
create policy liquidity_transfers_member_read on public.liquidity_transfers for select to authenticated using (public.has_organization_permission(organization_id,'liquidity.view'));
drop policy if exists liquidity_party_types_read on public.liquidity_party_types;
create policy liquidity_party_types_read on public.liquidity_party_types for select to authenticated using (public.has_organization_permission(organization_id,'liquidity.view'));

drop policy if exists organization_cost_centers_read on public.organization_cost_centers;
create policy organization_cost_centers_read on public.organization_cost_centers for select to authenticated using (public.has_organization_permission(organization_id,'organization.view'));
drop policy if exists organization_cost_centers_manage on public.organization_cost_centers;
create policy organization_cost_centers_manage on public.organization_cost_centers for all to authenticated
  using (public.has_organization_permission(organization_id,'organization.edit'))
  with check (public.has_organization_permission(organization_id,'organization.edit'));
drop policy if exists entity_org_access on public.organization_entities;
create policy entity_org_read on public.organization_entities for select to authenticated using (public.has_organization_permission(organization_id,'organization.view'));
create policy entity_org_insert on public.organization_entities for insert to authenticated with check (public.has_organization_permission(organization_id,'organization.edit'));
create policy entity_org_update on public.organization_entities for update to authenticated using (public.has_organization_permission(organization_id,'organization.edit')) with check (public.has_organization_permission(organization_id,'organization.edit'));
create policy entity_org_delete on public.organization_entities for delete to authenticated using (public.has_organization_permission(organization_id,'organization.edit'));

drop policy if exists consolidated_org_access on public.consolidated_assessments;
create policy consolidated_org_read on public.consolidated_assessments for select to authenticated using (public.has_organization_permission(organization_id,'zakat.view'));
create policy consolidated_org_write on public.consolidated_assessments for all to authenticated using (public.has_organization_permission(organization_id,'zakat.edit')) with check (public.has_organization_permission(organization_id,'zakat.edit'));

drop policy if exists fx_read on public.fx_rates;
create policy fx_read on public.fx_rates for select to authenticated using (organization_id is null or public.has_organization_permission(organization_id,'organization.view'));
drop policy if exists fx_org_insert on public.fx_rates;
create policy fx_org_insert on public.fx_rates for insert to authenticated with check (organization_id is not null and public.has_organization_permission(organization_id,'organization.edit'));
drop policy if exists fx_org_update on public.fx_rates;
create policy fx_org_update on public.fx_rates for update to authenticated using (organization_id is not null and public.has_organization_permission(organization_id,'organization.edit')) with check (organization_id is not null and public.has_organization_permission(organization_id,'organization.edit'));
drop policy if exists fx_org_delete on public.fx_rates;
create policy fx_org_delete on public.fx_rates for delete to authenticated using (organization_id is not null and public.has_organization_permission(organization_id,'organization.edit'));

drop policy if exists vat_profiles_member_read on public.vat_profiles;
create policy vat_profiles_member_read on public.vat_profiles for select to authenticated using (public.has_organization_permission(organization_id,'vat.view'));
drop policy if exists vat_profiles_admin_insert on public.vat_profiles;
create policy vat_profiles_admin_insert on public.vat_profiles for insert to authenticated with check (public.has_organization_permission(organization_id,'vat.edit'));
drop policy if exists vat_profiles_admin_update on public.vat_profiles;
create policy vat_profiles_admin_update on public.vat_profiles for update to authenticated using (public.has_organization_permission(organization_id,'vat.edit')) with check (public.has_organization_permission(organization_id,'vat.edit'));
drop policy if exists vat_profiles_admin_delete on public.vat_profiles;
create policy vat_profiles_admin_delete on public.vat_profiles for delete to authenticated using (public.has_organization_permission(organization_id,'vat.edit'));

drop policy if exists vat_documents_member_read on public.vat_documents;
create policy vat_documents_member_read on public.vat_documents for select to authenticated using (public.has_organization_permission(organization_id,'vat.view'));
drop policy if exists vat_documents_admin_insert on public.vat_documents;
create policy vat_documents_admin_insert on public.vat_documents for insert to authenticated with check (public.has_organization_permission(organization_id,'vat.edit'));
drop policy if exists vat_documents_admin_update on public.vat_documents;
create policy vat_documents_admin_update on public.vat_documents for update to authenticated using (public.has_organization_permission(organization_id,'vat.edit')) with check (public.has_organization_permission(organization_id,'vat.edit'));
drop policy if exists vat_documents_admin_delete on public.vat_documents;
create policy vat_documents_admin_delete on public.vat_documents for delete to authenticated using (public.has_organization_permission(organization_id,'vat.edit'));

drop policy if exists vat_contacts_member_read on public.vat_contacts;
create policy vat_contacts_member_read on public.vat_contacts for select to authenticated using (public.has_organization_permission(organization_id,'vat.view'));
drop policy if exists vat_contacts_admin_insert on public.vat_contacts;
create policy vat_contacts_admin_insert on public.vat_contacts for insert to authenticated with check (public.has_organization_permission(organization_id,'vat.edit'));
drop policy if exists vat_contacts_admin_update on public.vat_contacts;
create policy vat_contacts_admin_update on public.vat_contacts for update to authenticated using (public.has_organization_permission(organization_id,'vat.edit')) with check (public.has_organization_permission(organization_id,'vat.edit'));
drop policy if exists vat_contacts_admin_delete on public.vat_contacts;
create policy vat_contacts_admin_delete on public.vat_contacts for delete to authenticated using (public.has_organization_permission(organization_id,'vat.edit'));

drop policy if exists vat_einvoices_member_read on public.vat_einvoices;
create policy vat_einvoices_member_read on public.vat_einvoices for select to authenticated using (public.has_organization_permission(organization_id,'vat.view'));
drop policy if exists vat_einvoices_admin_insert on public.vat_einvoices;
create policy vat_einvoices_admin_insert on public.vat_einvoices for insert to authenticated with check (public.has_organization_permission(organization_id,'vat.edit'));
drop policy if exists vat_einvoices_admin_update on public.vat_einvoices;
create policy vat_einvoices_admin_update on public.vat_einvoices for update to authenticated using (public.has_organization_permission(organization_id,'vat.edit') and status='DRAFT') with check (public.has_organization_permission(organization_id,'vat.edit') and status='DRAFT');
drop policy if exists vat_einvoices_admin_delete on public.vat_einvoices;
create policy vat_einvoices_admin_delete on public.vat_einvoices for delete to authenticated using (public.has_organization_permission(organization_id,'vat.edit') and status='DRAFT');

drop policy if exists vat_einvoice_lines_member_read on public.vat_einvoice_lines;
create policy vat_einvoice_lines_member_read on public.vat_einvoice_lines for select to authenticated using (exists(select 1 from public.vat_einvoices i where i.id=invoice_id and public.has_organization_permission(i.organization_id,'vat.view')));
drop policy if exists vat_einvoice_lines_admin_insert on public.vat_einvoice_lines;
create policy vat_einvoice_lines_admin_insert on public.vat_einvoice_lines for insert to authenticated with check (exists(select 1 from public.vat_einvoices i where i.id=invoice_id and i.status='DRAFT' and public.has_organization_permission(i.organization_id,'vat.edit')));
drop policy if exists vat_einvoice_lines_admin_update on public.vat_einvoice_lines;
create policy vat_einvoice_lines_admin_update on public.vat_einvoice_lines for update to authenticated using (exists(select 1 from public.vat_einvoices i where i.id=invoice_id and i.status='DRAFT' and public.has_organization_permission(i.organization_id,'vat.edit'))) with check (exists(select 1 from public.vat_einvoices i where i.id=invoice_id and i.status='DRAFT' and public.has_organization_permission(i.organization_id,'vat.edit')));
drop policy if exists vat_einvoice_lines_admin_delete on public.vat_einvoice_lines;
create policy vat_einvoice_lines_admin_delete on public.vat_einvoice_lines for delete to authenticated using (exists(select 1 from public.vat_einvoices i where i.id=invoice_id and i.status='DRAFT' and public.has_organization_permission(i.organization_id,'vat.edit')));

drop policy if exists vat_period_summaries_member_read on public.vat_period_summaries;
create policy vat_period_summaries_member_read on public.vat_period_summaries for select to authenticated using (public.has_organization_permission(organization_id,'vat.view'));
drop policy if exists vat_period_summaries_admin_insert on public.vat_period_summaries;
create policy vat_period_summaries_admin_insert on public.vat_period_summaries for insert to authenticated with check (public.has_organization_permission(organization_id,'vat.edit'));
drop policy if exists vat_period_summaries_admin_update on public.vat_period_summaries;
create policy vat_period_summaries_admin_update on public.vat_period_summaries for update to authenticated using (public.has_organization_permission(organization_id,'vat.edit')) with check (public.has_organization_permission(organization_id,'vat.edit'));

create or replace function public.issue_vat_einvoice(p_invoice_id uuid)
returns public.vat_einvoices
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare
  v_invoice public.vat_einvoices;
  v_payload bytea := ''::bytea;
  v_values text[];
  v_value_bytes bytea;
  v_timestamp text;
  v_index integer;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_invoice from public.vat_einvoices where id=p_invoice_id for update;
  if not found then raise exception 'EINVOICE_NOT_FOUND'; end if;
  if not public.has_organization_permission(v_invoice.organization_id,'vat.issue') then raise exception 'VAT_ISSUE_FORBIDDEN'; end if;
  if v_invoice.status <> 'DRAFT' then raise exception 'EINVOICE_NOT_DRAFT'; end if;
  if v_invoice.document_type <> 'INVOICE' then raise exception 'NOTE_ISSUANCE_NOT_SUPPORTED'; end if;
  v_timestamp := to_char(v_invoice.issue_date,'YYYY-MM-DD') || 'T' || to_char(v_invoice.issue_time,'HH24:MI:SS') || '+03:00';
  v_values := array[v_invoice.seller_name,v_invoice.seller_vat_number,v_timestamp,
    to_char(v_invoice.tax_inclusive_amount,'FM99999999999999999990.00'),to_char(v_invoice.tax_total_amount,'FM99999999999999999990.00')];
  for v_index in 1..array_length(v_values,1) loop
    v_value_bytes := convert_to(v_values[v_index],'UTF8');
    if octet_length(v_value_bytes)>255 then raise exception 'QR_FIELD_TOO_LONG'; end if;
    v_payload := v_payload || decode(lpad(to_hex(v_index),2,'0'),'hex') || decode(lpad(to_hex(octet_length(v_value_bytes)),2,'0'),'hex') || v_value_bytes;
  end loop;
  if length(translate(encode(v_payload,'base64'),E'\n\r',''))>700 then raise exception 'QR_PAYLOAD_TOO_LONG'; end if;
  update public.vat_einvoices set status='ISSUED',qr_code=translate(encode(v_payload,'base64'),E'\n\r',''),issued_at=now(),updated_at=now()
    where id=p_invoice_id returning * into v_invoice;
  return v_invoice;
end;
$$;
revoke all on function public.issue_vat_einvoice(uuid) from public,anon;
grant execute on function public.issue_vat_einvoice(uuid) to authenticated;
