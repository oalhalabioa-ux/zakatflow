-- QA V2 ONLY: ubotbpjngtfvolthpfec. Do not apply to Production or legacy Financial Core.
-- Defence in depth for manually shared invitations: independently licensed invitee and owner,
-- confirmed recipient email, single-use token, atomic membership activation and audit.
create or replace function public.feasibility_accept_project_invitation(p_token_digest text)
returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
 v_invite public.feasibility_project_invitations%rowtype;
 v_user uuid := (select auth.uid());
 v_email text;
 v_confirmed timestamptz;
 v_owner uuid;
begin
 if v_user is null then raise exception 'UNAUTHORIZED'; end if;
 if p_token_digest !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INVITATION'; end if;
 if not exists(
  select 1 from public.feasibility_access_grants g where g.user_id=v_user
    and g.status in ('TRIAL','ACTIVE') and g.starts_at<=now()
    and (g.ends_at is null or g.ends_at>now())
 ) then raise exception 'FEASIBILITY_ACCESS_REQUIRED'; end if;

 select lower(u.email),u.email_confirmed_at into v_email,v_confirmed
 from auth.users u where u.id=v_user;
 if v_email is null or v_confirmed is null then raise exception 'CONFIRMED_EMAIL_REQUIRED'; end if;
 select * into v_invite from public.feasibility_project_invitations i
 where i.token_digest=p_token_digest and i.accepted_at is null
  and i.revoked_at is null and i.expires_at>now() for update;
 if not found or v_invite.invitee_email<>v_email then raise exception 'INVALID_INVITATION'; end if;
 select owner_user_id into v_owner from public.feasibility_projects where id=v_invite.project_id;
 if v_owner is null or v_owner=v_user or v_owner<>v_invite.created_by
 then raise exception 'INVALID_INVITATION'; end if;
 if not exists(
  select 1 from public.feasibility_access_grants g where g.user_id=v_owner
   and g.status in ('TRIAL','ACTIVE') and g.starts_at<=now()
   and (g.ends_at is null or g.ends_at>now())
 ) then raise exception 'INVITATION_NOT_ACTIVE'; end if;

 insert into public.feasibility_project_members(project_id,user_id,role,status,created_by)
 values(v_invite.project_id,v_user,v_invite.role,'ACTIVE',v_invite.created_by)
 on conflict(project_id,user_id) do update
 set role=excluded.role,status='ACTIVE',created_by=excluded.created_by,updated_at=now();
 update public.feasibility_project_invitations
 set accepted_by=v_user,accepted_at=now() where id=v_invite.id;
 insert into public.platform_audit_events(actor_user_id,event_type,entity_type,entity_id,details)
 values(v_user,'feasibility.invitation_accepted','feasibility_invitation',v_invite.id,
  jsonb_build_object('project_id',v_invite.project_id,'owner_user_id',v_owner,
    'accepted_user_id',v_user,'role',v_invite.role));
 return jsonb_build_object('project_id',v_invite.project_id,'role',v_invite.role,'status','ACCEPTED');
end
$function$;
revoke all on function public.feasibility_accept_project_invitation(text) from public,anon;
grant execute on function public.feasibility_accept_project_invitation(text) to authenticated;
