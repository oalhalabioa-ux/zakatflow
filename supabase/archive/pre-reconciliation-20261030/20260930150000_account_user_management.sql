-- Keep account roles and organization invitations controlled by authenticated RPCs.

drop policy if exists profiles_self on public.profiles;
create policy profiles_self_read on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_self_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (name, phone, base_currency, calendar_type, zakat_method_id, nisab_standard, timezone, locale, updated_at)
  on public.profiles to authenticated;

drop policy if exists org_member_manage on public.organization_members;
drop policy if exists org_member_insert_owner on public.organization_members;
create policy org_member_insert_owner on public.organization_members
  for insert to authenticated
  with check (
    user_id = auth.uid() and role = 'OWNER'
    and public.is_organization_owner(organization_id)
  );

alter table public.organization_invitations enable row level security;
drop policy if exists invitation_admin on public.organization_invitations;
revoke all on public.organization_invitations from authenticated;

create or replace function public.list_organization_users(p_organization_id uuid)
returns table(user_id uuid, email text, name text, role text, status text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.is_organization_admin(p_organization_id) then
    raise exception 'ORGANIZATION_ADMIN_REQUIRED';
  end if;
  return query
    select m.user_id, u.email::text, p.name, m.role, m.status, m.created_at
    from public.organization_members m
    join public.profiles p on p.id = m.user_id
    join auth.users u on u.id = m.user_id
    where m.organization_id = p_organization_id
    order by m.created_at, p.name;
end;
$$;

create or replace function public.list_organization_invitations(p_organization_id uuid)
returns table(id uuid, email text, role text, expires_at timestamptz, accepted_at timestamptz, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.is_organization_admin(p_organization_id) then
    raise exception 'ORGANIZATION_ADMIN_REQUIRED';
  end if;
  return query
    select i.id, i.email, i.role, i.expires_at, i.accepted_at, i.created_at
    from public.organization_invitations i
    where i.organization_id = p_organization_id
    order by i.created_at desc;
end;
$$;

create or replace function public.create_organization_invitation(
  p_organization_id uuid, p_email text, p_role text
)
returns table(id uuid, token text, email text, role text, expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_role text;
  v_email text := lower(trim(p_email));
  v_row public.organization_invitations%rowtype;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select m.role into v_actor_role from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id = auth.uid() and m.status = 'ACTIVE';
  if v_actor_role is null or v_actor_role not in ('OWNER','ADMIN') then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
  if v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then raise exception 'EMAIL_INVALID'; end if;
  if p_role not in ('ACCOUNTANT','ADVISOR','VIEWER','SHARIA_REVIEWER') then raise exception 'ROLE_INVALID'; end if;
  if v_actor_role <> 'OWNER' and p_role in ('ADMIN','OWNER') then raise exception 'ROLE_FORBIDDEN'; end if;
  if exists (select 1 from public.organization_members m join auth.users u on u.id=m.user_id
    where m.organization_id=p_organization_id and lower(u.email)=v_email and m.status='ACTIVE') then
    raise exception 'USER_ALREADY_MEMBER';
  end if;
  update public.organization_invitations set expires_at=now()
    where organization_id=p_organization_id and lower(email)=v_email and accepted_at is null and expires_at>now();
  insert into public.organization_invitations (organization_id,email,role)
    values (p_organization_id,v_email,p_role) returning * into v_row;
  return query select v_row.id,v_row.token,v_row.email,v_row.role,v_row.expires_at;
end;
$$;

create or replace function public.accept_organization_invitation(p_token text)
returns table(organization_id uuid, organization_name text, role text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_invitation public.organization_invitations%rowtype;
begin
  if v_user_id is null then raise exception 'UNAUTHORIZED'; end if;
  select lower(u.email) into v_email from auth.users u
    where u.id=v_user_id and u.email_confirmed_at is not null;
  if v_email is null then raise exception 'EMAIL_NOT_VERIFIED'; end if;
  select i.* into v_invitation from public.organization_invitations i
    where i.token=p_token and i.accepted_at is null and i.expires_at>now()
    for update;
  if not found then raise exception 'INVITATION_INVALID_OR_EXPIRED'; end if;
  if lower(v_invitation.email)<>v_email then raise exception 'INVITATION_EMAIL_MISMATCH'; end if;
  if v_invitation.role not in ('ACCOUNTANT','ADVISOR','VIEWER','SHARIA_REVIEWER') then raise exception 'INVITATION_ROLE_INVALID'; end if;
  insert into public.organization_members(organization_id,user_id,role,status)
    values(v_invitation.organization_id,v_user_id,v_invitation.role,'ACTIVE')
    on conflict (organization_id,user_id) do update set role=excluded.role,status='ACTIVE';
  update public.organization_invitations set accepted_at=now() where id=v_invitation.id;
  return query select o.id,o.name,v_invitation.role from public.organizations o where o.id=v_invitation.organization_id;
end;
$$;

create or replace function public.manage_organization_member(
  p_organization_id uuid, p_user_id uuid, p_role text, p_status text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_role text;
  v_target_role text;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select m.role into v_actor_role from public.organization_members m
    where m.organization_id=p_organization_id and m.user_id=auth.uid() and m.status='ACTIVE';
  if v_actor_role is null or v_actor_role not in ('OWNER','ADMIN') then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
  if p_role not in ('OWNER','ADMIN','ACCOUNTANT','ADVISOR','VIEWER','SHARIA_REVIEWER')
    or p_status not in ('ACTIVE','INACTIVE') then raise exception 'MEMBER_VALUE_INVALID'; end if;
  select m.role into v_target_role from public.organization_members m
    where m.organization_id=p_organization_id and m.user_id=p_user_id for update;
  if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
  if v_actor_role <> 'OWNER' and (v_target_role in ('OWNER','ADMIN') or p_role in ('OWNER','ADMIN')) then
    raise exception 'ROLE_FORBIDDEN';
  end if;
  if v_target_role='OWNER' and (p_role<>'OWNER' or p_status<>'ACTIVE') and not exists (
    select 1 from public.organization_members m where m.organization_id=p_organization_id
      and m.user_id<>p_user_id and m.role='OWNER' and m.status='ACTIVE'
  ) then raise exception 'LAST_OWNER_REQUIRED'; end if;
  if p_user_id=auth.uid() and (p_role<>v_actor_role or p_status<>'ACTIVE') then
    raise exception 'CANNOT_CHANGE_OWN_ACCESS';
  end if;
  update public.organization_members set role=p_role,status=p_status
    where organization_id=p_organization_id and user_id=p_user_id;
end;
$$;

create or replace function public.revoke_organization_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.organization_invitations i
    join public.organization_members m on m.organization_id=i.organization_id
    where i.id=p_invitation_id and m.user_id=auth.uid() and m.status='ACTIVE' and m.role in ('OWNER','ADMIN')
  ) then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
  delete from public.organization_invitations where id=p_invitation_id and accepted_at is null;
end;
$$;

revoke all on function public.list_organization_users(uuid) from public, anon;
revoke all on function public.list_organization_invitations(uuid) from public, anon;
revoke all on function public.create_organization_invitation(uuid,text,text) from public, anon;
revoke all on function public.accept_organization_invitation(text) from public, anon;
revoke all on function public.manage_organization_member(uuid,uuid,text,text) from public, anon;
revoke all on function public.revoke_organization_invitation(uuid) from public, anon;
grant execute on function public.list_organization_users(uuid) to authenticated;
grant execute on function public.list_organization_invitations(uuid) to authenticated;
grant execute on function public.create_organization_invitation(uuid,text,text) to authenticated;
grant execute on function public.accept_organization_invitation(text) to authenticated;
grant execute on function public.manage_organization_member(uuid,uuid,text,text) to authenticated;
grant execute on function public.revoke_organization_invitation(uuid) to authenticated;
