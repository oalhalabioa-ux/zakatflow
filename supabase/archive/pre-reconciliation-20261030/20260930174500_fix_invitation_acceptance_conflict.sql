-- Avoid ambiguity between RETURNS TABLE output variables and the unique
-- conflict target used when accepting an organization invitation.
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
  select i.* into v_invitation from public.organization_invitations i
    where i.token=p_token and i.accepted_at is null and i.expires_at>now() for update;
  if not found then raise exception 'INVITATION_INVALID_OR_EXPIRED'; end if;
  if lower(v_invitation.email)<>v_email then raise exception 'INVITATION_EMAIL_MISMATCH'; end if;
  if v_invitation.role not in ('ACCOUNTANT','ADVISOR','VIEWER','SHARIA_REVIEWER','CUSTOM') then
    raise exception 'INVITATION_ROLE_INVALID';
  end if;
  insert into public.organization_members(organization_id,user_id,role,status,custom_role_id)
    values(v_invitation.organization_id,v_user_id,v_invitation.role,'ACTIVE',v_invitation.custom_role_id)
    on conflict on constraint organization_members_pkey
    do update set role=excluded.role,status='ACTIVE',custom_role_id=excluded.custom_role_id;
  update public.organization_invitations as inv set accepted_at=now() where inv.id=v_invitation.id;
  return query select o.id,o.name,v_invitation.role
    from public.organizations o where o.id=v_invitation.organization_id;
end;
$$;
revoke all on function public.accept_organization_invitation(text) from public,anon;
grant execute on function public.accept_organization_invitation(text) to authenticated;
