-- Historical QA-only schema. Applied only to ubotbpjngtfvolthpfec.
-- Migration: feasibility_pending_invite_revocation_qa_v2.
create function public.feasibility_revoke_project_invitation(p_project_id uuid,p_invitation_id uuid)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare v_actor uuid := (select auth.uid()); v_revoked uuid;
begin
 if v_actor is null or not exists (
  select 1 from public.feasibility_projects p
  where p.id=p_project_id and p.owner_user_id=v_actor
 ) then raise exception 'PROJECT_OWNER_REQUIRED'; end if;
 update public.feasibility_project_invitations i set revoked_at=now()
 where i.id=p_invitation_id and i.project_id=p_project_id
 and i.created_by=v_actor and i.accepted_at is null and i.revoked_at is null
 returning i.id into v_revoked;
 if v_revoked is null then return false;end if;
 insert into public.platform_audit_events(actor_user_id,event_type,entity_type,entity_id,details)
 values(v_actor,'feasibility.invitation_revoked','feasibility_invitation',v_revoked,
  jsonb_build_object('project_id',p_project_id));
 return true;
end
$fn$;
revoke all on function public.feasibility_revoke_project_invitation(uuid,uuid) from public,anon;
grant execute on function public.feasibility_revoke_project_invitation(uuid,uuid) to authenticated;