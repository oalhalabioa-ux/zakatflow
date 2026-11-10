
-- Applied ONCE to Financial Core QA V2 only as feasibility_collaboration_private_helper_hardening_qa_v2.
create function private.feasibility_collaborator_role(p_project_id uuid)
returns text language sql stable security definer set search_path=''
as $fn$
 select m.role from public.feasibility_project_members m
 where m.project_id=p_project_id and m.user_id=(select auth.uid()) and m.status='ACTIVE' limit 1
$fn$;
revoke all on function private.feasibility_collaborator_role(uuid) from public,anon;
grant execute on function private.feasibility_collaborator_role(uuid) to authenticated;
drop policy feasibility_project_collaborator_read on public.feasibility_projects;
drop policy feasibility_project_collaborator_edit on public.feasibility_projects;
drop policy feasibility_owner_read on public.feasibility_projects;
drop policy feasibility_owner_update on public.feasibility_projects;
create policy feasibility_project_owner_or_member_read on public.feasibility_projects for select to authenticated
 using(owner_user_id=(select auth.uid()) or private.feasibility_collaborator_role(id) in ('VIEWER','REVIEWER','EDITOR'));
create policy feasibility_project_owner_or_editor_update on public.feasibility_projects for update to authenticated
 using(owner_user_id=(select auth.uid()) or private.feasibility_collaborator_role(id)='EDITOR')
 with check(owner_user_id=(select auth.uid()) or private.feasibility_collaborator_role(id)='EDITOR');
drop policy feasibility_member_self on public.feasibility_project_members;
drop policy feasibility_member_project_owner on public.feasibility_project_members;
create policy feasibility_member_owner_or_self_read on public.feasibility_project_members for select to authenticated
 using(user_id=(select auth.uid()) or exists(select 1 from public.feasibility_projects p
 where p.id=project_id and p.owner_user_id=(select auth.uid())));
drop function public.feasibility_collaborator_role(uuid);
create index feasibility_project_member_creator_idx on public.feasibility_project_members(created_by);
