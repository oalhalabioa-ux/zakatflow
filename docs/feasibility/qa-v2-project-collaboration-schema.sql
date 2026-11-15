-- QA V2 only, applied as feasibility_collaborators_role_model_qa_v2.
-- Never run against Production or the legacy Financial Core QA database.
create table public.feasibility_project_members (
 project_id uuid not null references public.feasibility_projects(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('EDITOR','REVIEWER','VIEWER')),
 status text not null default 'INVITED' check(status in ('INVITED','ACTIVE','REVOKED')),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(project_id,user_id)
);
comment on table public.feasibility_project_members is 'QA V2 opt-in project collaborators. INVITED and REVOKED members have zero study access; no client-side member mutations.';
create index feasibility_project_member_user_idx on public.feasibility_project_members(user_id,status);
alter table public.feasibility_project_members enable row level security;
create policy feasibility_member_self on public.feasibility_project_members
 for select to authenticated using(user_id=(select auth.uid()));
create policy feasibility_member_project_owner on public.feasibility_project_members
 for select to authenticated using(exists(select 1 from public.feasibility_projects p
 where p.id=project_id and p.owner_user_id=(select auth.uid())));
revoke all on table public.feasibility_project_members from public,anon,authenticated;
grant select on table public.feasibility_project_members to authenticated;
create function public.feasibility_collaborator_role(p_project_id uuid)
returns text language sql stable security definer set search_path=''
as $f$
 select m.role from public.feasibility_project_members m
 where m.project_id=p_project_id and m.user_id=(select auth.uid()) and m.status='ACTIVE' limit 1
$f$;
revoke all on function public.feasibility_collaborator_role(uuid) from public,anon;
grant execute on function public.feasibility_collaborator_role(uuid) to authenticated;
create policy feasibility_project_collaborator_read on public.feasibility_projects
 for select to authenticated using(public.feasibility_collaborator_role(id) in ('EDITOR','REVIEWER','VIEWER'));
create policy feasibility_project_collaborator_edit on public.feasibility_projects
 for update to authenticated using(public.feasibility_collaborator_role(id)='EDITOR')
 with check(public.feasibility_collaborator_role(id)='EDITOR');
