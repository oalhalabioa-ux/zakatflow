begin;

create index platform_audit_events_feasibility_project_idx
 on public.platform_audit_events(entity_id,created_at desc,id desc)
 where entity_type='feasibility_project';

create function private.feasibility_company_share_audit(p_organization uuid,p_project uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 actor uuid := auth.uid();
begin
 if actor is null or not private.feasibility_phase1_org_enabled()
  or not coalesce(private.feasibility_company_access(p_organization,false),false)
  or not exists (
   select 1 from public.organization_members m where m.organization_id=p_organization
    and m.user_id=actor and m.status='ACTIVE' and m.role='OWNER'
  )
  or not exists (
   select 1 from public.feasibility_projects p where p.id=p_project
    and p.organization_id=p_organization and p.owner_user_id is null
  ) then
  raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501';
 end if;

 return coalesce((
  select jsonb_agg(jsonb_build_object(
   'id',event.id,'kind',event.event_type,'occurred_at',event.created_at,
   'recipient_organization_id',event.details->'recipient_organization_id',
   'proposal_id',event.details->'proposal_id',
   'source_revision',event.details->'source_revision',
   'shared_revision',event.details->'shared_revision',
   'approved_revision',event.details->'approved_revision'
  ) order by event.created_at desc,event.id desc)
  from (
   select a.id,a.event_type,a.created_at,a.details
   from public.platform_audit_events a
   where a.entity_type='feasibility_project' and a.entity_id=p_project
    and a.details->>'source_organization_id'=p_organization::text
    and a.event_type in (
     'feasibility.organization_share_share','feasibility.organization_share_revoke',
     'feasibility.organization_share_edit','feasibility.share_proposal_submit',
     'feasibility.share_proposal_approve','feasibility.share_proposal_reject'
    )
   order by a.created_at desc,a.id desc limit 100
  ) event
 ),'[]'::jsonb);
end
$$;
revoke all on function private.feasibility_company_share_audit(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.feasibility_company_share_audit(uuid,uuid) to authenticated;

create function public.feasibility_company_share_audit(p_organization uuid,p_project uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select private.feasibility_company_share_audit(p_organization,p_project)
$$;
revoke all on function public.feasibility_company_share_audit(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.feasibility_company_share_audit(uuid,uuid) to authenticated;

commit;
