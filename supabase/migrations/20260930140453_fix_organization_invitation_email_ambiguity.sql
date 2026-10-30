-- Qualify the invitation table's email field to avoid colliding with the
-- RETURNS TABLE output parameter named `email` in PL/pgSQL.
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
  select m.role into v_actor_role
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.status = 'ACTIVE';
  if v_actor_role is null or v_actor_role not in ('OWNER','ADMIN') then
    raise exception 'ORGANIZATION_ADMIN_REQUIRED';
  end if;
  if v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then raise exception 'EMAIL_INVALID'; end if;
  if p_role not in ('ACCOUNTANT','ADVISOR','VIEWER','SHARIA_REVIEWER') then raise exception 'ROLE_INVALID'; end if;
  if v_actor_role <> 'OWNER' and p_role in ('ADMIN','OWNER') then raise exception 'ROLE_FORBIDDEN'; end if;
  if exists (
    select 1
    from public.organization_members m
    join auth.users u on u.id = m.user_id
    where m.organization_id = p_organization_id
      and lower(u.email) = v_email
      and m.status = 'ACTIVE'
  ) then
    raise exception 'USER_ALREADY_MEMBER';
  end if;
  update public.organization_invitations as inv
    set expires_at = now()
    where inv.organization_id = p_organization_id
      and lower(inv.email) = v_email
      and inv.accepted_at is null
      and inv.expires_at > now();
  insert into public.organization_invitations (organization_id, email, role)
    values (p_organization_id, v_email, p_role)
    returning * into v_row;
  return query select v_row.id, v_row.token, v_row.email, v_row.role, v_row.expires_at;
end;
$$;

revoke all on function public.create_organization_invitation(uuid,text,text) from public, anon;
grant execute on function public.create_organization_invitation(uuid,text,text) to authenticated;
