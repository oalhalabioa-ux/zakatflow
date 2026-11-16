-- A missing membership produces NULL for a NOT IN comparison in PL/pgSQL.
-- Treat that case as an explicit denial in both security-definer RPCs.
create or replace function public.create_organization_invitation(
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
  if v_actor_role is null or v_actor_role not in ('OWNER','ADMIN') then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
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

create or replace function public.manage_organization_member(
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
  if v_actor_role is null or v_actor_role not in ('OWNER','ADMIN') then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
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

revoke all on function public.create_organization_invitation(uuid,text,text,uuid) from public,anon;
revoke all on function public.manage_organization_member(uuid,uuid,text,text,uuid) from public,anon;
grant execute on function public.create_organization_invitation(uuid,text,text,uuid) to authenticated;
grant execute on function public.manage_organization_member(uuid,uuid,text,text,uuid) to authenticated;
